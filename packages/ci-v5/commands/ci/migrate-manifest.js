const fs = require('fs')
const cli = require('heroku-cli-util')
const co = require('co')
const BB = require('bluebird')
const writeFile = BB.promisify(fs.writeFile)
const unlinkFile = BB.promisify(fs.unlink)

function * run (context, heroku) {
  const appJSONPath = `${process.cwd()}/app.json`
  const appCiJSONPath = `${process.cwd()}/app-ci.json`
  let action

  function showWarning () {
    cli.log(cli.color.green('Please check the contents of your app.json before committing to your repo.'))
  }

  function * updateAppJson () {
    yield cli.action(
      // Updating / Creating
      `${action.charAt(0).toUpperCase() + action.slice(1)} app.json file`,
      writeFile(appJSONPath, `${JSON.stringify(appJSON, null, '  ')}\n`)
    )
  }

  let appJSON, appCiJSON

  try {
    appJSON = require(appJSONPath)
    action = 'updating'
  } catch (e) {
    action = 'creating'
    appJSON = {}
  }

  try {
    appCiJSON = require(appCiJSONPath)
  } catch (e) {
    let msg = `We couldn't find an app-ci.json file in the current directory`
    if (appJSON.environments == null) {
      msg += `, but we're ${action} ${action === 'updating' ? 'your' : 'a new'} app.json manifest for you.`
      appJSON.environments = {}
      cli.log(msg)
      yield updateAppJson()
      showWarning()
    } else {
      msg += `, and your app.json already has the environments key.`
      cli.log(msg)
    }
  }

  if (appCiJSON) {
    if (appJSON.environments && appJSON.environments.test) {
      cli.warn(`Your app.json already had a test key. We're overwriting it with the content of your app-ci.json`)
    }

    if (appJSON.environments == null) {
      appJSON.environments = {}
    }

    appJSON.environments.test = appCiJSON
    yield updateAppJson()
    yield cli.action(
      'Deleting app-ci.json file',
      unlinkFile(appCiJSONPath)
    )
    showWarning()
  }

  cli.log(`You're all set! 🎉`)
}

module.exports = {
  topic: 'ci',
  command: 'migrate-manifest',
  needsApp: false,
  needsAuth: false,
  description: 'app-ci.json is deprecated. Run this command to migrate to app.json with an environments key.',
  help: `Example:

    $ heroku ci:migrate-manifest
    Writing app.json file... done
    Deleting app-ci.json file... done
    Please check the contents of your app.json before committing to your repo
    You're all set! 🎉.`,
  run: cli.command(co.wrap(run))
}
