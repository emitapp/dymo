#!/usr/bin/env node
//Only designed for *nix

const pjson = require('./package.json');
const path = require('path');
const { getInstalledPath } = require('get-installed-path')
const term = require('terminal-kit').terminal;
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const { hashElement } = require('folder-hash');
const { Octokit } = require("@octokit/rest");
const { execSync } = require('child_process');


//Change for your project
const IOS_CP_KEY = "LumberjackApps/Biteup-iOS"
const ANDROID_CP_KEY = "LumberjackApps/Biteup-Android"
const PROD_DEPLOYMENT_NAME = "Production"
const DEV_DEPLOYMENT_NAME = "Staging"
const HASHING_PATH = '.'
const TARGET_GIT_REMOTE = "https://github.com/emitapp/emit.git"
const MAIN_GIT_BRANCH = "master"
const IOS_CP_TAG_PREFIX = "ios-cp-"
const ANDROID_CP_TAG_PREFIX = "android-cp-"
const GIT_REPO_OWNER = "emitapp"
const GIT_REPO_NAME = "emit"

//Stuff you probably don't wanna change
const GIT_USER_AGENT = "https://github.com/emitapp/dymo"
const ANDROID_CHOICE_INDEX = 0
const IOS_CHOICE_INDEX = 1
const BOTH_CHOICE_INDEX = 2
const MENU_OPTIONS = { cancelable: true }
const ORANGE_HEX = "#FFA500"
const MODES = {
    PROD: "prod",
    DEV: "dev",
    CLEAR_DEV: "clear"
}

const main = async () => {
    try {
        const args = parseArguments()
        listenForCtrlC()
        await checkForCorrectGitRemote()
        await installEnv()

        if (args.mode == MODES.PROD) {
            checkForGithubKey()
            await checkForMoreutils()

            const platformChoice = await getPlatformChoice();
            term("\n")
            const lastVersions = await displayLastProdCPInfo(platformChoice)
            const hash = await calculateProjectHash()
            term(`Current project hash: ^g${hash.hash}^ (from ^+${recursivelyCountHashChildren(hash)}^ hashed files)`)
            term("\n")("\n")
            const commitHash = await chooseCommitToTag()
            const extraMessage = await getExtraReleaseMessage()

            if (userChoseAndroid(platformChoice))
                await codepushAndTag(true, lastVersions, hash, commitHash, extraMessage, args)

            if (userChoseIOS(platformChoice))
                await codepushAndTag(false, lastVersions, hash, commitHash, extraMessage, args)
        } else if (args.mode == MODES.DEV) {
            const platformChoice = await getPlatformChoice();
            term("\n")

            if (userChoseAndroid(platformChoice))
                await deployToCodepush(true, args)

            if (userChoseIOS(platformChoice))
                await deployToCodepush(false, args)
        }


    } catch (err) {
        term.error.nextLine(1).red(err).nextLine(1)
    } finally {
        process.exit()
    }
}

const installEnv = async () => {
    const installationPath = await getInstalledPath(pjson.name)
    const env = require('dotenv').config({ path: path.join(installationPath, ".env") })
    if (env.error) {
        throw env.error
    }
}

const parseArguments = () => {
    const args = process.argv.slice(2);
    let mode = ""

    //Ugly repitition but whatever
    if (args.includes("prod")) {
        if (mode) {
            term.red("Choose only one mode")("\n")
            process.exit()
        }
        mode = MODES.PROD
    }

    if (args.includes("dev")) {
        if (mode) {
            term.red("Choose only one mode")("\n")
            process.exit()
        }
        mode = MODES.DEV
    }

    if (args.includes("clear")) {
        term.red("Clear mode not supported yet! Generally, clearing codepush deployments is unsafe")("\n")
        term.red("For now, you'll have to enter these manually:")("\n")
        term.yellow(`code-push deployment clear ${ANDROID_CP_KEY} ${DEV_DEPLOYMENT_NAME}`)("\n")
        term.yellow(`code-push deployment clear ${IOS_CP_KEY} ${DEV_DEPLOYMENT_NAME}`)("\n")
        process.exit()
    }

    if (!mode) {
        term.red("Usage: dymo [dev | prod | clean] [m]")("\n")
        process.exit()
    }

    const argsObj = {
        mode,
        mandatory: args.includes("m"),
    }

    return argsObj
}

//TODO: consider switching to something like https://stackoverflow.com/questions/26350256/node-js-multiline-input
//NOTE: Vipe is not available on windows. 
const checkForMoreutils = async () => {
    try {
        const command = "which vipe" //For some reason, `where` fails if vipe is not installed
        const { stdout, stderr } = await exec(command);
        if (!stdout) {
            term.red("vipe (part of moreutils) not found. Installation instructions: https://rentes.github.io/unix/utilities/2015/07/27/moreutils-package/")
            term("\n")
            process.exit()
        }
    } catch {
        term.red("which vipe failed")
        term.red("vipe (part of moreutils) probably not found. Installation instructions: https://rentes.github.io/unix/utilities/2015/07/27/moreutils-package/")
        term("\n")
        process.exit()
    }
}

const checkForCorrectGitRemote = async () => {
    const command = `git remote get-url origin`
    const { stdout, stderr } = await exec(command);
    if (stderr) throw stderr
    const url = stdout.trim()
    if (url != TARGET_GIT_REMOTE) {
        term.yellow(`Incorrect git remote. Looking for ${TARGET_GIT_REMOTE}, got ${url}`)("\n")
        process.exit()
    }
}

const listenForCtrlC = () => {
    term.grabInput(); //More info about this here: https://blog.soulserv.net/tag/terminal/
    term.on('key', function (name, matches, data) {
        if (!name) return;
        if (name === 'CTRL_C') {
            term("\n")("\n").red("Dymo cancelled by user.")("\n")
            process.exit();
        }
    });
}

const getPlatformChoice = async () => {
    term.bgColorRgbHex(ORANGE_HEX)('Which platforms do you want to CP to?').bgDefaultColor();

    const items = [
        'ANDROID only',
        'IOS only',
        'BOTH'
    ];

    const platformChoice = await term.singleColumnMenu(items, MENU_OPTIONS).promise;

    if (platformChoice.canceled) {
        term.red("Cancelled \n");
        process.exit();
    }

    return platformChoice
}

const userChoseAndroid = (platformChoice) => {
    const choiceIndex = platformChoice.selectedIndex
    return choiceIndex == ANDROID_CHOICE_INDEX || choiceIndex == BOTH_CHOICE_INDEX
}

const userChoseIOS = (platformChoice) => {
    const choiceIndex = platformChoice.selectedIndex
    return choiceIndex == IOS_CHOICE_INDEX || choiceIndex == BOTH_CHOICE_INDEX
}

const displayLastProdCPInfo = async (platformChoice) => {
    const versionInfo = {
        ANDROID: undefined,
        IOS: undefined
    }

    const fetchPromise = async (isAndroid) => {
        const infoArray = await getVersionInfo(isAndroid)
        const lastVersion = infoArray[0] ?? "v0"
        const releaseDate = infoArray[1] ?? "-"
        const binaryTarget = infoArray[2] ?? "-"
        versionInfo[isAndroid ? "ANDROID" : "IOS"] = { lastVersion, releaseDate, binaryTarget }
        return `^g${isAndroid ? "Android" : "iOS"}^: Last v: ^+^y${lastVersion}^ ^ released at ${releaseDate} for binary ${binaryTarget}`
    }
    const promises = []
    if (userChoseAndroid(platformChoice)) {
        promises.push(fetchPromise(true))
    }
    if (userChoseIOS(platformChoice)) {
        promises.push(fetchPromise(false))
    }

    const s = await term.spinner("impulse");
    term('Getting version info...');
    const results = await Promise.all(promises)
    s.animate(false)
    term.eraseLine().column(0)
    results.forEach(r => term(r)("\n"))
    return versionInfo
}

const getVersionInfo = async (isAndroid) => {
    const name = isAndroid ? ANDROID_CP_KEY : IOS_CP_KEY
    const command = `appcenter codepush deployment history -a ${name} ${PROD_DEPLOYMENT_NAME} --output json`
    const { stdout, stderr } = await exec(command);
    if (stderr) throw stderr
    const parsedResult = JSON.parse(stdout)
    if (parsedResult.length == 0) return []
    return (parsedResult[parsedResult.length - 1])
}

const calculateProjectHash = async () => {
    const options = {
        folders: { exclude: ['.*', 'node_modules', 'test_coverage', 'android', 'ios', "__tests__",] },
        files: { exclude: ['.DS_Store'] },
    };
    return await hashElement(HASHING_PATH, options)
}

const recursivelyCountHashChildren = (hashObject) => {
    if (!hashObject.children) return 1
    const reducer = (prevValue, currentValue) => {
        return prevValue + recursivelyCountHashChildren(currentValue)
    }
    return hashObject.children.reduce(reducer, 0)
}

const chooseCommitToTag = async () => {
    //More info on decorate here: https://stackoverflow.com/q/63673227
    const command = `git log -n 5 --oneline origin/${MAIN_GIT_BRANCH} --decorate=short`
    const { stdout, stderr } = await exec(command);
    if (stderr) throw stderr

    const commits = stdout.trim().split("\n").map(c => c.trim())
    term.bgColorRgbHex(ORANGE_HEX)('Which remote commit should be tagged?').bgDefaultColor();
    const commitChoice = await term.singleColumnMenu(commits, MENU_OPTIONS).promise;

    if (commitChoice.canceled) {
        term.red("Cancelled \n");
        process.exit();
    }

    const chosenCommitHash = commits[commitChoice.selectedIndex].split(" ")[0]
    return chosenCommitHash
}

const getFullCommitHash = async (hash) => {
    const command = `git rev-parse ${hash}`
    const { stdout, stderr } = await exec(command);
    if (stderr) throw stderr
    return stdout
}

const checkForGithubKey = () => {
    if (!process.env.GITHUB_KEY) {
        term.red("Missing Github Personal Access Token \n");
        process.exit();
    }
}

const tagGithubRepo = async (codepushVersion, isAndroid, hash, commitHash, extraMessage) => {
    //https://octokit.github.io/rest.js/v18#usage
    const octokit = new Octokit({
        auth: process.env.GITHUB_KEY,
        userAgent: GIT_USER_AGENT, //https://docs.github.com/en/rest/overview/resources-in-the-rest-api#user-agent-required
    })

    const baseName = isAndroid ? ANDROID_CP_TAG_PREFIX : IOS_CP_TAG_PREFIX
    let body = `Release made with [Dymo](https://github.com/emitapp/dymo) v${pjson.version} \n`;
    body += `Project hash: \`${hash.hash}\` (from ${recursivelyCountHashChildren(hash)} hashed files).`
    body += `\n`
    body += extraMessage
    const title = `${isAndroid ? "Android" : "iOS"} Codepush v${codepushVersion}`

    await octokit.rest.repos.createRelease({
        owner: GIT_REPO_OWNER,
        repo: GIT_REPO_NAME,
        tag_name: baseName + codepushVersion,
        body,
        target_commitish: (await getFullCommitHash(commitHash)).trim(),
        name: title
    });
}

const getExtraReleaseMessage = async () => {
    term.bgColorRgbHex(ORANGE_HEX)('Add extra Github Release info?').bgDefaultColor();
    const choice = await term.singleColumnMenu(["NO", "YES"], MENU_OPTIONS).promise;

    if (choice.canceled) {
        term.red("Cancelled \n");
        process.exit();
    }

    if (choice.selectedIndex == 0) return ""

    //https://unix.stackexchange.com/questions/125580/piping-commands-modify-stdin-write-to-stdout
    //(I use nano because vim is evil and noone can convince me otherwise)
    const command = `echo "" | EDITOR=nano vipe | cat`
    const message = (await execSync(command)).toString().trim(); //Using normal exec result in bad input delay in nano
    return message
}

codepushAndTag = async (isAndroid, lastVersions, projectHash, commitHash, extraMessage, processArgs) => {
    //Getting the version of the next release (the one about to be made)
    const newVersionString = (isAndroid ? lastVersions.ANDROID : lastVersions.IOS).lastVersion.replace(/\D/g, '')
    let newVersion = parseInt(newVersionString)
    if (isNaN(newVersion)) {
        term.red("Version is NaN O.o \n");
        process.exit();
    }
    newVersion += 1;
    await tagGithubRepo(newVersion, isAndroid, projectHash, commitHash, extraMessage)
    await deployToCodepush(isAndroid, processArgs)
}

const deployToCodepush = async (isAndroid, processArgs) => {
    const name = isAndroid ? ANDROID_CP_KEY : IOS_CP_KEY
    const deployment = processArgs.mode == MODES.PROD ? PROD_DEPLOYMENT_NAME : DEV_DEPLOYMENT_NAME
    const mandatory = processArgs.mandatory ? "-m" : ""
    const xCodeSchema = (processArgs.mode == MODES.PROD && !isAndroid) ? "-c \"Prod.Release\"" : ""
    const command = `appcenter codepush release-react -a ${name} -d ${deployment} ${mandatory} ${xCodeSchema}`
    const execPromise = exec(command);
    execPromise.child.stdout.pipe(process.stdout)
    const { stderr } = await execPromise
    if (stderr) throw stderr
}

main()
