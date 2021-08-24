# Dymo
Dymo is the CLI tool for managing Emit's Codepushes and git tags.

[How it got its name.](https://www.dymoshop.eu/prod1-Label-printer-Dymo-LetraTag-LT-100H.html)

Dymo is only meant to be used inside a directory that contains the Emit app client code (ie the React Native code.)

How to install Dymo locally:

1. Clone this repo
2. `cd` into dymo and `npm link`. More on this [here](https://stackoverflow.com/a/56814994).
3. Create a `.env` file in the root directory of dymo and add this `GITHUB_KEY=xxxxxxx` (with your own key).. Info on how to make a key can be found [here](https://docs.github.com/en/github/authenticating-to-github/keeping-your-account-and-data-secure/creating-a-personal-access-token)
4. Now you can just run `dymo`

<sup><sub>Originally designed and implemented in Maui 🏝️</sub></sup>



