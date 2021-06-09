
// stretch goals
// loading a game
// reorder players=
// mix order of suits
// tell you who's turn it is to deal (over multiple games)

import { action, makeAutoObservable, observable, observe, toJS } from "mobx"

// starting a game
/// adding players, name
/// set the order of players, mark dealer (or is it just first?)
/// - HCDS, NT order of trumps
/// 7 cards first round, say how many you think you're going to win
/// first person is to the dealers left
/// made it -> 10 points + bid, don't make it -> 0
/// total can't add up to the number of cards

type Suit = 'H' | 'C' | 'D' | 'S' | 'NT'
type Player = {
  name: string
}

export class DB {

  // stretch, mix up suts
  turns = [
    { num_cards: 7, suit: 'H', },
    { num_cards: 6, suit: 'C', },
    { num_cards: 5, suit: 'D', },
    { num_cards: 4, suit: 'S', },
    { num_cards: 3, suit: 'NT', },
    { num_cards: 2, suit: 'H', },
    { num_cards: 1, suit: 'C', },
    { num_cards: 2, suit: 'D', },
    { num_cards: 3, suit: 'S', },
    { num_cards: 4, suit: 'NT', },
    { num_cards: 5, suit: 'H', },
    { num_cards: 6, suit: 'C', },
    { num_cards: 7, suit: 'D', },
  ]

  data_keys = ['players']

  players: Player[] = []


  constructor() {


    makeAutoObservable(this)

    this.players = this.localGet('players') ?? []
    console.log('starting db')

    observe(this, (change) => {
      console.log(this, change.name)
      this.localSet('players', toJS(this.players))
    })
    observe(this.players, (change) => {
      console.log(change)
      this.localSet('players', toJS(this.players))
    })
  }

  // get players(): Player[] {
  //   return this.localGet('players') ?? []
  // }
  //  set players(players: Player[]) {
  //   this.localSet('players', players)
  // }

  @action addPlayer = (name: string) => {
    const players = this.players
    if (players.find(p => p.name === name)) {
      return
    }
    players.push({ name })
    this.players = players
  }

  @action removePlayer = (name: string) => {
    const players = this.players.filter(p => p.name !== name)
    this.players = players
  }

  private encodeKey = (key: string) => {
    return 'scorebard_app-' + key
  }
  private localGet = (key: string) => {
    const info = window.localStorage.getItem(this.encodeKey(key))
    if (info) {
      return JSON.parse(info)
    }
    return null
  }
  private localSet = (key: string, vals: any) => {
    window.localStorage.setItem(this.encodeKey(key), JSON.stringify(vals))
  }
}