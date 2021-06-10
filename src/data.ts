
// stretch goals
// loading a game
// reorder players=
// mix order of suits
// tell you who's turn it is to deal (over multiple games)

import localforage from "localforage"
import { action, makeAutoObservable, reaction, toJS } from "mobx"

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
  data_keys = ['players']
  default_players = new Map([
    [1, { id: 1, name: null }],
    [2, { id: 2, name: null }],
    [3, { id: 3, name: null }],
    [4, { id: 4, name: null }],
  ])
  players = this.default_players
  game: any[] = [{ dealer_player_id: 1, turn_id: 1, player1_bid: 1, player2_bid: 1, player3_bid: 1, player4_bid: 1, player1_tricks: 2, player2_tricks: 3, player3_tricks: 3, player4_tricks: 4, }]
  current_round_id = 1

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

    this.current_round_id = 1
    this.players = this.default_players

    // TODO set players to the ones from the previous game

    this.playRound(this.current_round_id)
  }

  playRound = (round_id: number) => {
    const { num_cards } = this.turns.get(round_id)!

  }

  constructor() {
    makeAutoObservable(this)

    localforage.setDriver([localforage.INDEXEDDB, localforage.WEBSQL, localforage.LOCALSTORAGE])

    console.log('starting db')
    this.loadData()
  }

  @action changePlayer = (id: number, name: string) => {
    const player = this.players.get(id)
    player.name = name
  }

  loadData = () => {
    console.log('Loading data')
    Promise.all([
      this.localGet('players').then(action((resp: any) => {
        console.log(resp)
        this.players = resp ?? this.default_players
      }
      )),
    ]).then(() => {
      reaction(
        () => Array.from(this.players.values()).map(todo => [todo.id, todo.name]),
        () => this.localSet('players', this.players)
      )
    })
  }

  private localGet = (key: string) => {
    return localforage.getItem(key)
  }
  private localSet = (key: string, vals: any) => {
    return localforage.setItem(key, toJS(vals))
  }
}