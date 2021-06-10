
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
    [1, { id: 1, name: null }],
    [2, { id: 2, name: null }],
    [3, { id: 3, name: null }],
    [4, { id: 4, name: null }],
  ])
  current_round = 1
  current_player = 1
  current_dealer = 1
  stage: 'bid' | 'score' = 'bid'
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
    ])
      .then(() => {
        reaction(
          () => Array.from(this.players.values()).map(todo => [todo.id, todo.name]),
          () => this.localSet('players', this.players)
        )
      })
      .then(action(() => {
        // TODO load score from storage
        this.scoresheet = this.getEmptyScoreSheet()
      }))
  }

  next_round = () => {
    const previous_dealer_id = this.current_dealer
    let next_dealer_id = previous_dealer_id + 1
    if (next_dealer_id > this.players.size) {
      next_dealer_id = 1
    }
    let round = {
      dealer_id: next_dealer_id,
      all_bid: false
    }
    this.players.forEach(p => {
      round[`player${p.id}_bid`] = null
      round[`player${p.id}_tricks`] = null
    })
    this.current_dealer = next_dealer_id
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


  @computed get bid_options(): number[] {
    const all_options = [0, 1, 2, 3, 4, 5, 6, 7]
    const turn = this.turns.get(this.current_round)
    let options = all_options.filter(o => o <= turn.num_cards)
    if (this.current_player !== this.players.size) {
      return options
    }

    const sum_bids = Object.values(this.scoresheet.get(this.current_round))
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
    const round = this.scoresheet.get(this.current_round)
    round[player_id].bid = bid
    if (this.current_player === this.players.size) {
      this.current_player = 1
      this.stage = 'score'
      return
    }
    this.current_player += 1
  }

  setScoreForPlayer = (player_id, made_it) => {
    const round = this.scoresheet.get(this.current_round)
    if (!made_it) {
      round[player_id].score = 0
    } else {
      round[player_id].score = round[player_id].bid + 10
    }
    if (this.current_player === this.players.size) {
      this.current_player = 1
      this.current_round += 1
      this.stage = 'bid'
      return
    }
    this.current_player += 1
  }

  newGame = (players: Player[]) => {
    if (players.length < 2) {
      alert('Cannot play with less than 2 players')
      return
    }
    if (players.length > 4) {
      alert('More than 4 players not supported currently')
      return
    }
    // TODO random dealer
    const dealer = players[0]

    this.current_round = 1
    this.players = this.default_players
    this.scoresheet = this.getEmptyScoreSheet()

    // TODO set players to the ones from the previous game
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