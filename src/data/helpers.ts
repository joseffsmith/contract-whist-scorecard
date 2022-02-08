import localforage from 'localforage'
import { toJS } from 'mobx'

import { DEALS, DEFAULT_PLAYERS } from '../constants'
import { Player, Round, Scoresheet } from '../types'


export const localGet = (key: string): Promise<any> => {
  return localforage.getItem(key)
}

export const localSet = (key: string, vals: any): Promise<any> => {
  return localforage.setItem(key, toJS(vals))
}

export const loadPlayers = (uuid: string): Promise<Player[]> => {
  return localGet(`${uuid}-players`)
    .then(players => {
      if (!players) {
        players = DEFAULT_PLAYERS
      }
      return players
    })
}

export const loadScoresheet = (uuid: string, players: Player[]): Promise<Scoresheet> => {
  return localGet(`${uuid}-scoresheet`)
    .then(scoresheet => {
      if (!scoresheet) {
        scoresheet = getEmptyScoreSheet(players)
      }
      return scoresheet
    })
}

export const getNewRound = (players: Player[]): Round => players.map(p => { return { 'bid': null, 'score': null } })

export const getEmptyScoreSheet = (players: Player[]): Scoresheet => DEALS.map(deal => getNewRound(players))