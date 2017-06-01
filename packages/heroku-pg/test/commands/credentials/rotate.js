'use strict'
/* global describe it beforeEach afterEach */

const cli = require('heroku-cli-util')
const expect = require('unexpected')
const nock = require('nock')
const proxyquire = require('proxyquire')

const db = {
  database: 'mydb',
  host: 'foo.com',
  user: 'jeff',
  password: 'pass',
  url: {href: 'postgres://jeff:pass@foo.com/mydb'}
}

const addon = {
  id: 1,
  name: 'postgres-1',
  plan: {name: 'heroku-postgresql:standard-0'}
}

const attachments = [
  {
    namespace: 'credential:my_role',
    app: { name: 'appname_1' }
  },
  {
    namespace: 'credential:my_role',
    app: { name: 'appname_2' }
  },
  {
    namespace: 'credential:other_role',
    app: { name: 'appname_3' }
  }
]

const fetcher = () => {
  return {
    database: () => db,
    addon: () => addon
  }
}

const cmd = proxyquire('../../../commands/credentials/rotate', {
  '../../lib/fetcher': fetcher
})

let lastApp, lastConfirm, lastMsg

const confirmApp = function * (app, confirm, msg) {
  lastApp = app
  lastConfirm = confirm
  lastMsg = msg
}

describe('pg:credentials:rotate', () => {
  let api, pg, starter, confirm

  beforeEach(() => {
    api = nock('https://api.heroku.com')
    api.get('/addons/postgres-1/addon-attachments').reply(200, attachments)
    pg = nock('https://postgres-api.heroku.com')
    starter = nock('https://postgres-starter-api.heroku.com')
    confirm = cli.confirmApp
    cli.confirmApp = confirmApp
    cli.mockConsole()
    cli.exit.mock()
  })

  afterEach(() => {
    cli.confirmApp = confirm
    nock.cleanAll()
    api.done()
  })

  it('rotates credentials for a specific role with --name', () => {
    pg.post('/postgres/v0/databases/postgres-1/credentials/my_role/credentials_rotation').reply(200)
    return cmd.run({app: 'myapp', args: {}, flags: {name: 'my_role', confirm: 'myapp'}})
              .then(() => expect(cli.stdout, 'to equal', ''))
              .then(() => expect(cli.stderr, 'to equal', 'Rotating my_role on postgres-1... done\n'))
  })

  it('rotates credentials for all roles with --all', () => {
    pg.post('/postgres/v0/databases/postgres-1/credentials_rotation').reply(200)
    return cmd.run({app: 'myapp', args: {}, flags: {all: true, confirm: 'myapp'}})
              .then(() => expect(cli.stdout, 'to equal', ''))
              .then(() => expect(cli.stderr, 'to equal', 'Rotating all credentials on postgres-1... done\n'))
  })

  it('rotates credentials for a specific role with --name and --force', () => {
    pg.post('/postgres/v0/databases/postgres-1/credentials/my_role/credentials_rotation').reply(200)
    return cmd.run({app: 'myapp', args: {}, flags: {name: 'my_role', confirm: 'myapp', force: true}})
        .then(() => expect(cli.stdout, 'to equal', ''))
    .then(() => expect(cli.stderr, 'to equal', 'Rotating my_role on postgres-1... done\n'))
  })

  it('fails with an error if both --all and --name are included', () => {
    const err = new Error(`cannot pass both --all and --name`)
    return expect(cmd.run({app: 'myapp', args: {}, flags: {all: true, name: 'my_role', confirm: 'myapp'}}), 'to be rejected with', err)
  })

  it('fails with an error if both --force and --all are included', () => {
    const err = new Error(`Cannot force rotate all credentials: the default credential cannot be force rotated.`)
    return expect(cmd.run({app: 'myapp', args: {}, flags: {force: true, all: true, confirm: 'myapp'}}), 'to be rejected with', err)
  })

  it('fails with an error if both --name default and --force are included', () => {
    const err = new Error(`Cannot force rotate the default credential.`)
    return expect(cmd.run({app: 'myapp', args: {}, flags: {force: true, name: 'default', confirm: 'myapp'}}), 'to be rejected with', err)
  })

  it('throws an error when the db is starter plan but the name is specified', () => {
    const hobbyAddon = {
      name: 'postgres-1',
      plan: {name: 'heroku-postgresql:hobby-dev'}
    }

    const fetcher = () => {
      return {
        database: () => db,
        addon: () => hobbyAddon
      }
    }

    const cmd = proxyquire('../../../commands/credentials/rotate', {
      '../../lib/fetcher': fetcher
    })

    const err = new Error(`Only one default credential is supported for Hobby tier databases.`)
    return expect(cmd.run({app: 'myapp', args: {}, flags: {name: 'jeff'}}), 'to be rejected with', err)
  })

  it('rotates credentials with no --name with starter plan', () => {
    const hobbyAddon = {
      name: 'postgres-1',
      plan: {name: 'heroku-postgresql:hobby-dev'}
    }

    const fetcher = () => {
      return {
        database: () => db,
        addon: () => hobbyAddon
      }
    }

    const cmd = proxyquire('../../../commands/credentials/rotate', {
      '../../lib/fetcher': fetcher
    })

    starter.post('/postgres/v0/databases/postgres-1/credentials/default/credentials_rotation').reply(200)
    return cmd.run({app: 'myapp', args: {}, flags: {confirm: 'myapp'}})
              .then(() => expect(cli.stdout, 'to equal', ''))
              .then(() => expect(cli.stderr, 'to equal', 'Rotating default on postgres-1... done\n'))
  })

  it('rotates credentials with --all with starter plan', () => {
    const hobbyAddon = {
      name: 'postgres-1',
      plan: {name: 'heroku-postgresql:hobby-dev'}
    }

    const fetcher = () => {
      return {
        database: () => db,
        addon: () => hobbyAddon
      }
    }

    const cmd = proxyquire('../../../commands/credentials/rotate', {
      '../../lib/fetcher': fetcher
    })

    starter.post('/postgres/v0/databases/postgres-1/credentials_rotation').reply(200)
    return cmd.run({app: 'myapp', args: {}, flags: {all: true, confirm: 'myapp'}})
              .then(() => expect(cli.stdout, 'to equal', ''))
              .then(() => expect(cli.stderr, 'to equal', 'Rotating all credentials on postgres-1... done\n'))
  })

  it('requires app confirmation for rotating all roles with --all', () => {
    pg.post('/postgres/v0/databases/postgres-1/credentials_rotation').reply(200)

    const message = `WARNING: Destructive Action
Connections will be reset and applications will be restarted.
This command will affect the apps appname_1, appname_2, appname_3.`

    return cmd.run({app: 'myapp',
      args: {},
      flags: { all: true, confirm: 'myapp' }})
    .then(() => {
      expect(lastApp, 'to equal', 'myapp')
      expect(lastConfirm, 'to equal', 'myapp')
      expect(lastMsg, 'to equal', message)
    })
  })

  it('requires app confirmation for rotating a specific role with --name', () => {
    pg.post('/postgres/v0/databases/postgres-1/credentials/my_role/credentials_rotation').reply(200)

    const message = `WARNING: Destructive Action
The password for the my_role credential will rotate.
Connections older than 30 minutes will be reset, and a temporary rotation username will be used during the process.
This command will affect the apps appname_1, appname_2.`

    return cmd.run({app: 'myapp',
      args: {},
      flags: { name: 'my_role', confirm: 'myapp' }})
    .then(() => {
      expect(lastApp, 'to equal', 'myapp')
      expect(lastConfirm, 'to equal', 'myapp')
      expect(lastMsg, 'to equal', message)
    })
  })

  it('requires app confirmation for force rotating a specific role with --name and --force', () => {
    pg.post('/postgres/v0/databases/postgres-1/credentials/my_role/credentials_rotation').reply(200)

    const message = `WARNING: Destructive Action
The password for the my_role credential will rotate.
Connections will be reset and applications will be restarted.
This command will affect the apps appname_1, appname_2.`

    return cmd.run({app: 'myapp',
      args: {},
      flags: { name: 'my_role', force: true, confirm: 'myapp' }})
    .then(() => {
      expect(lastApp, 'to equal', 'myapp')
      expect(lastConfirm, 'to equal', 'myapp')
      expect(lastMsg, 'to equal', message)
    })
  })
})
