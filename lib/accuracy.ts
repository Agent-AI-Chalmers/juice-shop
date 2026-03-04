/*
 * Copyright (c) 2014-2021 Bjoern Kimminich.
 * SPDX-License-Identifier: MIT
 */

import { type ChallengeKey } from 'models/challenge'
import logger from './logger'
import colors from 'colors/safe'
const solves: Record<string, { 'find it': boolean, attempts: { 'find it': number } }> = {}

export const storeFindItVerdict = (challengeKey: ChallengeKey, verdict: boolean) => {
  storeVerdict(challengeKey, 'find it', verdict)
}

export const calculateFindItAccuracy = (challengeKey: ChallengeKey) => {
  return calculateAccuracy(challengeKey, 'find it')
}

export const totalFindItAccuracy = () => {
  return totalAccuracy('find it')
}

export const getFindItAttempts = (challengeKey: ChallengeKey) => {
  return solves[challengeKey] ? solves[challengeKey].attempts['find it'] : 0
}

function totalAccuracy (phase: 'find it') {
  let sumAccuracy = 0
  let totalSolved = 0
  Object.entries(solves).forEach(([key, value]) => {
    if (value[phase]) {
      sumAccuracy += 1 / value.attempts[phase]
      totalSolved++
    }
  })
  return sumAccuracy / totalSolved
}

function calculateAccuracy (challengeKey: ChallengeKey, phase: 'find it') {
  let accuracy = 0
  if (solves[challengeKey][phase]) {
    accuracy = 1 / solves[challengeKey].attempts[phase]
  }
  logger.info(`Accuracy for 'Find It' phase of coding challenge ${colors.cyan(challengeKey)}: ${accuracy > 0.5 ? colors.green(accuracy.toString()) : (accuracy > 0.25 ? colors.yellow(accuracy.toString()) : colors.red(accuracy.toString()))}`)
  return accuracy
}

function storeVerdict (challengeKey: ChallengeKey, phase: 'find it', verdict: boolean) {
  if (!solves[challengeKey]) {
    solves[challengeKey] = { 'find it': false, attempts: { 'find it': 0 } }
  }
  if (!solves[challengeKey][phase]) {
    solves[challengeKey][phase] = verdict
    solves[challengeKey].attempts[phase]++
  }
}
