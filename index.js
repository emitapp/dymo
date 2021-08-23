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


//Change for your project
const IOS_PROD_CP_KEY = "LumberjackApps/Biteup-iOS"
const ANDROID_PROD_CP_KEY = "LumberjackApps/Biteup-Android"
const PROD_DEPLOYMENT_NAME = "Production"
const HASHING_PATH = '/Users/andersonaddo/lunchme'
const TARGET_GIT_REMOTE = "https://github.com/andersonaddo/github-playground.git"
const MAIN_GIT_BRANCH = "master"
const IOS_CP_TAG_PREFIX = "ios-cp-"
const ANDROID_CP_TAG_PREFIX = "android-cp-"
const GIT_USER_AGENT = "https://github.com/emitapp/dymo"
const GIT_REPO_OWNER = "andersonaddo"
const GIT_REPO_NAME = "github-playground"

//Stuff you probably don't wanna change
const ANDROID_CHOICE_INDEX = 0
const IOS_CHOICE_INDEX = 1
const BOTH_CHOICE_INDEX = 2
const MENU_OPTIONS = { cancelable: true }
const ORANGE_HEX = "#FFA500"

const main = async () => {
    try {
        await installEnv()
        checkForGithubKey()
        await checkForCorrectGitRemote()
        listenForCtrlC()

        const platformChoice = await getPlatformChoice();
        term("\n")
        await displayVersionInfo(platformChoice)

        const hash = await calculateProjectHash()
        term(`Current project hash: ^g${hash.hash}^ (from ^+${recursivelyCountHashChildren(hash)}^ hashed files)`)
        term("\n")("\n")

        const commitHash = await chooseCommitToTag()

        await tagGithubRepo(3, false, hash, commitHash)

    } catch (err) {
        term.error.nextLine(1).red(err).nextLine(1)
    } finally {
        process.exit()
    }
}

const installEnv = async () => {
    const installationPath = await getInstalledPath(pjson.name)
    const env = require('dotenv').config({ path: path.join(installationPath, ".env")})
    if (env.error) {
        throw env.error
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

const displayVersionInfo = async (platformChoice) => {
    const choiceIndex = platformChoice.selectedIndex
    if (choiceIndex == ANDROID_CHOICE_INDEX || choiceIndex == BOTH_CHOICE_INDEX) {
        term.saveCursor()
        const s = await term.spinner("impulse");
        term('Getting last Android version info...');
        const info = await getVersionInfo(true)
        s.animate(false)
        term.eraseLine().column(0).green("Android")(info)("\n")
    }
    if (choiceIndex == IOS_CHOICE_INDEX || choiceIndex == BOTH_CHOICE_INDEX) {
        term.saveCursor()
        const s = await term.spinner("impulse");
        term('Getting last iOS version info...');
        const info = await getVersionInfo(false)
        s.animate(false)
        term.eraseLine().column(0).green("iOS")(info)("\n")
    }
}

const getVersionInfo = async (isAndroid) => {
    const name = isAndroid ? ANDROID_PROD_CP_KEY : IOS_PROD_CP_KEY
    const command = `appcenter codepush deployment history -a ${name} ${PROD_DEPLOYMENT_NAME} | grep "v[0-9]*" | tail -1`
    const { stdout, stderr } = await exec(command);
    if (stderr) throw stderr
    return stdout
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

    const commits = stdout.split("\n").map(c => c.trim())
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
    if (!process.env.GITHUB_KEY){
        term.red("Missing Github Personal Access Token \n");
        process.exit();
    }
}

const tagGithubRepo = async (codepushVersion, isAndroid, hash, commitHash) => {
    //https://octokit.github.io/rest.js/v18#usage
    const octokit = new Octokit({
        auth: process.env.GITHUB_KEY,
        userAgent: GIT_USER_AGENT, //https://docs.github.com/en/rest/overview/resources-in-the-rest-api#user-agent-required
    })

    const baseName = isAndroid ? ANDROID_CP_TAG_PREFIX : IOS_CP_TAG_PREFIX
    let body = `Release made with Dymo v${pjson.version} \n`;
    body += `Project hash: \`${hash.hash}\` (from ${recursivelyCountHashChildren(hash)} hashed files).`
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

main()
