
// stretch goals
// loading a game
// reorder players=
// mix order of suits
// tell you who's turn it is to deal (over multiple games)

import localforage from "localforage"
import { action, computed, makeAutoObservable, reaction, toJS } from "mobx"

// starting a game
/// adding players, name
/// set the order of players, mark dealer (or is it just first?)
/// - HCDS, NT order of trumps
/// 7 cards first round, say how many you think you're going to win
/// first person is to the dealers left
/// made it -> 10 points + bid, don't make it -> 0
/// total can't add up to the number of cards

// type Suit = 'H' | 'C' | 'D' | 'S' | 'NT'
type Player = {
  id: number
  name: string | null
}

export class DB {
  turns = new Map([
    [1, { id: 1, num_cards: 7, suit_colour: 'text-red-500', suit: '♥', }],
    [2, { id: 2, num_cards: 6, suit_colour: 'text-black', suit: '♣', }],
    [3, { id: 3, num_cards: 5, suit_colour: 'text-red-500', suit: '♦', }],
    [4, { id: 4, num_cards: 4, suit_colour: 'text-black', suit: '♠', }],
    [5, { id: 5, num_cards: 3, suit_colour: 'text-green-500', suit: '🚫', }],
    [6, { id: 6, num_cards: 2, suit_colour: 'text-red-500', suit: '♥', }],
    [7, { id: 7, num_cards: 1, suit_colour: 'text-black', suit: '♣', }],
    [8, { id: 8, num_cards: 2, suit_colour: 'text-red-500', suit: '♦', }],
    [9, { id: 9, num_cards: 3, suit_colour: 'text-black', suit: '♠', }],
    [10, { id: 10, num_cards: 4, suit_colour: 'text-green-500', suit: '🚫', }],
    [11, { id: 11, num_cards: 5, suit_colour: 'text-red-500', suit: '♥', }],
    [12, { id: 12, num_cards: 6, suit_colour: 'text-black', suit: '♣', }],
    [13, { id: 13, num_cards: 7, suit_colour: 'text-red-500', suit: '♦', }],
  ])
  default_players = new Map([
    [1, { id: 1, name: 'Player 1' }],
    [2, { id: 2, name: 'Player 2' }],
    [3, { id: 3, name: 'Player 3' }],
    [4, { id: 4, name: 'Player 4' }],
  ])
  current_dealer = 1
  players = this.default_players
  scoresheet: Map<number, { [k: string]: any }> = new Map()

  constructor() {
    makeAutoObservable(this)
    localforage.setDriver([localforage.INDEXEDDB, localforage.WEBSQL, localforage.LOCALSTORAGE])
    console.log('starting db')
    this.loadData()
  }

  loadData = () => {
    console.log('Loading data')
    Promise.all([
      this.localGet('players').then(action((resp: any) => {
        this.players = resp ?? this.default_players
      })),
      this.localGet('scoresheet').then(action((resp: any) => {
        this.scoresheet = resp ?? this.getEmptyScoreSheet()
      })),
      this.localGet('current_dealer').then(action((resp: any) => {
        this.current_dealer = resp ?? 1
      })),
    ])
      .then(() => {
        reaction(
          () => Array.from(this.players.values()).map(todo => [todo.id, todo.name]),
          () => this.localSet('players', this.players)
        )
        reaction(
          () => Array.from(this.scoresheet.values()).map(players => Object.values(players).map(p => [p.bid, p.score])),
          () => this.localSet('scoresheet', this.scoresheet)
        )
        reaction(
          () => this.current_dealer,
          () => this.localSet('current_dealer', this.current_dealer)
        )
        reaction(
          () => this.current_round_id,
          () => this.current_dealer += 1
        )
      })
  }

  @action newGame = () => {
    this.players = this.default_players
    this.scoresheet = this.getEmptyScoreSheet()
    this.current_dealer = 1
  }

  getEmptyScoreSheet = () => {
    const players = Object.fromEntries(new Map(Array.from(this.players.keys()).map(p => ([p, { 'bid': null, 'score': null }]))))
    const bids = new Map(Array.from(this.turns.keys()).map(t => ([t, players])))
    return bids
  }

  @computed get scores() {
    const scores = Array.from(this.scoresheet.values()).reduce((acc, curr_value) => {
      return acc.map((a, idx) => a + (curr_value[idx + 1].score ?? 0))
    }, Array.from(this.players.values()).map(p => 0))
    return scores
  }

  @computed get current_round_id() {
    return Array.from(this.scoresheet.values()).findIndex(turn => Object.values(turn).some(p => p.bid === null || p.score === null)) + 1
  }

  @computed get current_round() {
    return this.scoresheet.get(this.current_round_id)
  }

  @computed get stage() {
    return Object.values(this.current_round).some(p => p.bid === null) ? 'bid' : 'score'
  }

  @computed get current_player() {
    return this.stage === 'bid' ? Object.values(this.current_round).findIndex(p => p.bid === null) + 1 : Object.values(this.current_round).findIndex(p => p.score === null) + 1
  }

  // when round starts first player after dealer
  // when in middle round it's first null value after dealer


  @computed get bids_left() {
    return Object.values(this.current_round).reduce((acc, curr_val) => {
      return acc + (curr_val.bid === null ? 1 : 0)
    }, 0)
  }

  @computed get current_turn() {
    return this.turns.get(this.current_round_id)
  }


  @computed get bid_options(): number[] {
    const all_options = [0, 1, 2, 3, 4, 5, 6, 7]
    const turn = this.current_turn
    console.log(toJS(turn))
    let options = all_options.filter(o => o <= turn.num_cards)
    if (this.bids_left !== 1) {
      return options
    }

    const sum_bids = Object.values(this.current_round)
      .reduce((acc, player) => {
        return acc + player.bid
      }, 0)

    if (turn.num_cards < sum_bids) {
      return options
    }

    const cant_say = turn.num_cards - sum_bids
    return options.filter(o => o !== cant_say)
  }

  setBidForPlayer = (player_id, bid) => {
    const round = this.current_round
    round[player_id].bid = bid
  }

  setScoreForPlayer = (player_id, made_it) => {
    const round = this.current_round
    if (!made_it) {
      round[player_id].score = 0
    } else {
      round[player_id].score = round[player_id].bid + 10
    }
  }

  @action changePlayer = (id: number, name: string) => {
    const player = this.players.get(id)
    player.name = name
  }

  private localGet = (key: string) => {
    return localforage.getItem(key)
  }
  private localSet = (key: string, vals: any) => {
    return localforage.setItem(key, toJS(vals))
  }
}
