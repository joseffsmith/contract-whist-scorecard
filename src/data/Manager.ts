import localforage from 'localforage'
import { action, observable, reaction } from 'mobx'
import { v4 as uuidv4 } from 'uuid'

import { Game, Player } from '../types'

import { loadPlayers, localGet, localSet } from './helpers'
import { Scoreboard } from './Scoreboard'


export class Manager {
  @observable games: Game[] = []
  @observable games_loaded: boolean = false
  @observable highlight_scores: Map<string, { players: Player[], scores: number[], created_at: Date }> = new Map()

  constructor() {
    localforage.setDriver([localforage.INDEXEDDB, localforage.WEBSQL, localforage.LOCALSTORAGE])
    this.loadGames().then(action(resp => {
      this.games = resp
      this.games_loaded = true
    }))
    reaction(
      () => this.games.map(game => [game.uuid, game.created_at]),
      () => localSet('games', this.games)
    )
  }

  @action
  loadGames = async (): Promise<Game[]> => {
    return await localGet('games') ?? []
  }

  @action
  getMostRecentGame = (): Game => {
    if (this.games.length === 0) {
      const game = {
        uuid: uuidv4(),
        created_at: new Date(),
      }
      this.games.unshift(game)
    }
    return this.games[0]
  }

  @action
  newGame = (): Game => {
    // save previous players (if any) as next players
    const previous_game = this.getMostRecentGame()
    const game = {
      uuid: uuidv4(),
      created_at: new Date(),
    }

    loadPlayers(previous_game.uuid)
      .then(players => {
        localSet(`${game.uuid}-players`, players)
      })

    this.games.unshift(game)
    return game
  }

  @action updateHighlightScores = () => {
    this.games.forEach(async g => {

      const scoresheet = await localGet(`${g.uuid}-scoresheet`)
      const players = await localGet(`${g.uuid}-players`)

      if (!scoresheet || !players) {
        return
      }
      const scoreboard = new Scoreboard(g.uuid, scoresheet, players)
      this.highlight_scores.set(g.uuid, {
        players,
        scores: scoreboard.scores,
        created_at: g.created_at,
      })
    })
  }
}
