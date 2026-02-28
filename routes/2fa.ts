

import config from 'config'
import { type Request, type Response } from 'express'
import { BasketModel } from '../models/basket'
import { UserModel } from '../models/user'
import * as challengeUtils from '../lib/challengeUtils'
import * as utils from '../lib/utils'
import { challenges } from '../data/datacache'
import * as otplib from 'otplib'
import * as security from '../lib/insecurity'

otplib.authenticator.options = {
  
  
  window: 1
}

export async function verify (req: Request, res: Response) {
  const { tmpToken, totpToken } = req.body

  try {
    const { userId, type } = security.verify(tmpToken) && security.decode(tmpToken)

    if (type !== 'password_valid_needs_second_factor_token') {
      throw new Error('Invalid token type')
    }

    const user = await UserModel.findByPk(userId)
    if (user == null) {
      throw new Error('No such user found!')
    }

    const isValid = otplib.authenticator.check(totpToken, user.totpSecret)

    const plainUser = utils.queryResultToJson(user)

    if (!isValid) {
      return res.status(401).send()
    }
    challengeUtils.solveIf(challenges.twoFactorAuthUnsafeSecretStorageChallenge, () => { return user.email === 'wurstbrot@' + config.get<string>('application.domain') })

    const [basket] = await BasketModel.findOrCreate({ where: { UserId: userId } })

    const token = security.authorize(plainUser)
    // @ts-expect-error FIXME set new property for original basket
    plainUser.bid = basket.id 
    security.authenticatedUsers.put(token, plainUser)

    res.json({ authentication: { token, bid: basket.id, umail: user.email } })
  } catch (error) {
    res.status(401).send()
  }
}


export async function status (req: Request, res: Response) {
  try {
    const data = security.authenticatedUsers.from(req)
    if (!data) {
      throw new Error('You need to be logged in to see this')
    }
    const { data: user } = data

    if (user.totpSecret === '') {
      const secret = otplib.authenticator.generateSecret()

      res.json({
        setup: false,
        secret,
        email: user.email,
        setupToken: security.authorize({
          secret,
          type: 'totp_setup_secret'
        })
      })
    } else {
      res.json({
        setup: true
      })
    }
  } catch (error) {
    res.status(401).send()
  }
}


export async function setup (req: Request, res: Response) {
  try {
    const data = security.authenticatedUsers.from(req)
    if (!data) {
      throw new Error('Need to login before setting up 2FA')
    }
    const { data: user } = data

    const { password, setupToken, initialToken } = req.body

    if (user.password !== security.hash(password)) {
      throw new Error('Password doesnt match stored password')
    }

    if (user.totpSecret !== '') {
      throw new Error('User has 2fa already setup')
    }

    const { secret, type } = security.verify(setupToken) && security.decode(setupToken)
    if (type !== 'totp_setup_secret') {
      throw new Error('SetupToken is of wrong type')
    }
    if (!otplib.authenticator.check(initialToken, secret)) {
      throw new Error('Initial token doesnt match the secret from the setupToken')
    }

    
    const userModel = await UserModel.findByPk(user.id)
    if (userModel == null) {
      throw new Error('No such user found!')
    }

    userModel.totpSecret = secret
    await userModel.save()
    security.authenticatedUsers.updateFrom(req, utils.queryResultToJson(userModel))

    res.status(200).send()
  } catch (error) {
    res.status(401).send()
  }
}


export async function disable (req: Request, res: Response) {
  try {
    const data = security.authenticatedUsers.from(req)
    if (!data) {
      throw new Error('Need to login before setting up 2FA')
    }
    const { data: user } = data

    const { password } = req.body

    if (user.password !== security.hash(password)) {
      throw new Error('Password doesnt match stored password')
    }

    
    const userModel = await UserModel.findByPk(user.id)
    if (userModel == null) {
      throw new Error('No such user found!')
    }

    userModel.totpSecret = ''
    await userModel.save()
    security.authenticatedUsers.updateFrom(req, utils.queryResultToJson(userModel))

    res.status(200).send()
  } catch (error) {
    res.status(401).send()
  }
}
