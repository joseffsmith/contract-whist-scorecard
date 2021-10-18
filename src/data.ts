import localforage from 'localforage'
import { action, computed, observable, reaction, toJS } from "mobx"
import { v4 as uuidv4 } from 'uuid'

type Stage = 'bid' | 'score'
type Turn = { bid: null | number, score: null | number }
type Round = Turn[]
export type Scoresheet = Round[]
export type Player = { id: number, name: string }
type Game = {
  uuid: string,
  created_at: Date
}

const DEALS = [
  { id: 0, num_cards: 7, suit_colour: 'text-red-500', suit: '♥', },
  { id: 1, num_cards: 6, suit_colour: 'text-black', suit: '♣', },
  { id: 2, num_cards: 5, suit_colour: 'text-red-500', suit: '♦', },
  { id: 3, num_cards: 4, suit_colour: 'text-black', suit: '♠', },
  { id: 4, num_cards: 3, suit_colour: 'text-green-500', suit: '🚫', },
  { id: 5, num_cards: 2, suit_colour: 'text-red-500', suit: '♥', },
  { id: 6, num_cards: 1, suit_colour: 'text-black', suit: '♣', },
  { id: 7, num_cards: 2, suit_colour: 'text-red-500', suit: '♦', },
  { id: 8, num_cards: 3, suit_colour: 'text-black', suit: '♠', },
  { id: 9, num_cards: 4, suit_colour: 'text-green-500', suit: '🚫', },
  { id: 10, num_cards: 5, suit_colour: 'text-red-500', suit: '♥', },
  { id: 11, num_cards: 6, suit_colour: 'text-black', suit: '♣', },
  { id: 12, num_cards: 7, suit_colour: 'text-red-500', suit: '♦', },
]

const PLAYERS: Player[] = [
  { id: 0, name: 'Player 1' },
  { id: 1, name: 'Player 2' },
  { id: 2, name: 'Player 3' },
  { id: 3, name: 'Player 4' },
]

const localGet = (key: string): Promise<any> => {
  return localforage.getItem(key)
}
const localSet = (key: string, vals: any): Promise<any> => {
  return localforage.setItem(key, toJS(vals))
}
export class Manager {
  @observable games: Game[] = []
  @observable games_loaded: boolean = false

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

  // @action
  // loadGame = async (uuid: string) => {
  //   const scoresheet = await this.loadScoreboard(uuid)
  //   this.current_scoreboard = new Scoreboard(uuid, scoresheet)
  // }

  // Import by navigating to a url, if they keep hitting it, we keep importing
  // TODO probably don't want to import the same game multiple times, only import when uri changes?
  @action
  importGame = (uri: string): Game => {
    const scoresheet = JSON.parse(atob(decodeURIComponent(uri)))
    const uuid = uuidv4()
    const game = {
      uuid,
      created_at: new Date(),
    }
    this.games.unshift(game)
    localSet(`${uuid}-scoresheet`, scoresheet)
    // this.current_scoreboard = new Scoreboard(uuid, scoresheet)
    return game
  }

}

export class Scoreboard {
  @observable uuid: string
  @observable scoresheet: Scoresheet
  @observable players: Player[]

  @observable deals = DEALS

  constructor(uuid: string, scoresheet: Scoresheet, players: Player[]) {
    this.uuid = uuid
    this.scoresheet = scoresheet
    this.players = players

    localforage.setDriver([localforage.INDEXEDDB, localforage.WEBSQL, localforage.LOCALSTORAGE])

    reaction(
      () => this.players.map(todo => [todo.id, todo.name]),
      () => localSet(`${this.uuid}-players`, this.players)
    )
    reaction(
      () => this.scoresheet.map(turns => turns.map(p => [p.bid, p.score])),
      () => localSet(`${this.uuid}-scoresheet`, this.scoresheet)
    )
  }

  @computed get scores() {
    return this.scoresheet.reduce((acc, curr_value) => {
      return acc.map((a, idx) => a + (curr_value[idx].score ?? 0))
    }, Array.from(this.players.values()).map(p => 0))
  }

  @computed get stage(): Stage | null { return (this.current_round && this.current_turn) ? this.getCurrentStageFromTurn(this.current_turn) : null }
  @computed get current_turn() { return this.current_round && this.current_round_idx !== null ? this.getCurrentTurnFromRound(this.current_round, this.current_round_idx) : null }
  @computed get current_turn_idx() { return this.current_turn && this.current_round ? this.current_round.indexOf(this.current_turn) : null }
  @computed get current_round() { return this.getCurrentRoundFromScoresheet(this.scoresheet) }
  @computed get current_round_idx() { return this.current_round ? this.scoresheet.indexOf(this.current_round) : null }
  @computed get dealer_idx() { return this.current_round_idx !== null ? (this.current_round_idx + this.players.length - 1) % this.players.length : null }
  @computed get current_deal() { return this.current_round_idx !== null ? this.deals[this.current_round_idx] : null }

  @computed get bids_left() {
    return (this.current_round && this.current_round.reduce((acc, curr_val) => {
      return acc + (curr_val.bid === null ? 1 : 0)
    }, 0)) ?? 0
  }

  @computed get bid_options(): { number: number, disabled: boolean }[] {
    const all_options = [{ number: 0, disabled: false }, { number: 1, disabled: false }, { number: 2, disabled: false }, { number: 3, disabled: false }, { number: 4, disabled: false }, { number: 5, disabled: false }, { number: 6, disabled: false }, { number: 7, disabled: false }]
    const turn = this.current_deal
    if (!turn || this.current_round === null) {
      return []
    }

    const options = all_options.filter(o => o.number <= turn.num_cards)
    if (this.bids_left !== 1) {
      return options
    }

    const sum_bids = this.current_round
      .reduce((acc, player) => {
        return acc + (player.bid ?? 0)
      }, 0)

    if (turn.num_cards < sum_bids) {
      return options
    }

    const cant_say = turn.num_cards - sum_bids
    options.forEach(o => {
      if (o.number === cant_say) {
        o.disabled = true
      }
    })
    return options
  }

  @action
  undo = () => {
    let round_to_undo = this.current_round
    let index = this.current_round_idx!
    if (round_to_undo?.every(t => t.bid === null && t.score === null)) {
      index -= 1
      round_to_undo = this.scoresheet[index]
    }
    if (!round_to_undo) {
      return
    }
    let turn = this.getCurrentTurnFromRound(round_to_undo, index)
    if (!turn) {
      let last_player_idx = (index % this.players.length)
      if (last_player_idx < 0) {
        last_player_idx = this.players.length - 1
      }
      turn = round_to_undo[last_player_idx]
    }
    let turn_idx = round_to_undo.indexOf(turn)
    turn_idx -= 1
    if (turn_idx < 0) {
      turn_idx = this.players.length - 1
    }
    const turn_to_undo = round_to_undo[turn_idx]
    if (turn_to_undo.score !== null) {
      turn_to_undo.score = null
      return
    }
    turn_to_undo.bid = null
  }

  @action
  setBidForPlayer = (player_idx: number, bid: number) => {
    if (this.current_round_idx !== null) {
      this.scoresheet[this.current_round_idx][player_idx].bid = bid
    }
  }

  @action
  setScoreForPlayer = (player_idx: number, made_it: boolean) => {
    if (this.current_round_idx === null) {
      return
    }
    if (!made_it) {
      this.scoresheet[this.current_round_idx][player_idx].score = 0
      return
    }
    this.scoresheet[this.current_round_idx][player_idx].score = this.scoresheet[this.current_round_idx][player_idx].bid! + 10
  }

  @action
  changePlayer = (idx: number, name: string) => {
    this.players[idx].name = name
  }

  getCurrentStageFromTurn = (turn: Turn): Stage | null => {
    if (turn.bid === null) {
      return 'bid'
    }
    if (turn.score === null) {
      return 'score'
    }
    return null
  }

  getCurrentTurnFromRound = (round: Round, round_idx: number): Turn | null => {
    const dealer_idx = round_idx % this.players.length
    const r = [...round.slice(dealer_idx), ...round.slice(0, dealer_idx)]
    return (
      r.find(t => this.getCurrentStageFromTurn(t) === 'bid') ??
      r.find(t => this.getCurrentStageFromTurn(t) === 'score') ??
      null
    )
  }

  getCurrentRoundFromScoresheet = (scoresheet: Scoresheet): Round | null => {
    return scoresheet.find((round, idx) => this.getCurrentTurnFromRound(round, idx) !== null) ?? null
  }
}

export const loadPlayers = (uuid: string): Promise<Player[]> => {
  return localGet(`${uuid}-players`)
    .then(players => {
      if (!players) {
        players = PLAYERS
      }
      return players
    })
}

export const loadScoresheet = (uuid: string): Promise<Scoresheet> => {
  return localGet(`${uuid}-scoresheet`)
    .then(scoresheet => {
      if (!scoresheet) {
        scoresheet = getEmptyScoreSheet()
      }
      return scoresheet
    })
}

export const getNewRound = (): Round => PLAYERS.map(p => { return { 'bid': null, 'score': null } })

export const getEmptyScoreSheet = (): Scoresheet => DEALS.map(deal => getNewRound())