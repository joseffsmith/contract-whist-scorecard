import localforage from 'localforage'
import { action, computed, observable, reaction } from "mobx"

import { DEALS } from '../constants'
import { Deal, Player, Round, Scoresheet, Stage, Turn } from '../types'

import { getEmptyScoreSheet, localSet } from './helpers'


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

    localSet(`${this.uuid}-players`, this.players)
    localSet(`${this.uuid}-scoresheet`, this.scoresheet)
    reaction(
      () => this.players.map(todo => [todo.id, todo.name]),
      () => localSet(`${this.uuid}-players`, this.players)
    )
    reaction(
      () => this.scoresheet.map(turns => turns.map(p => [p.bid, p.score])),
      () => localSet(`${this.uuid}-scoresheet`, this.scoresheet)
    )
  }

  get scores(): number[] {
    return this.scoresheet.reduce((acc, curr_value) => {
      return acc.map((a, idx) => a + (curr_value[idx].score ?? 0))
    }, Array.from(this.players.values()).map(p => 0))
  }

  get stage(): Stage | null {
    return this.current_turn ? this.getCurrentStageFromTurn(this.current_turn) : null
  }

  get current_turn(): Turn | null {
    return (this.current_round && this.current_round_idx !== null) ? this.getCurrentTurnFromRound(this.current_round, this.current_round_idx) : null
  }

  get current_turn_idx(): number | null {
    return this.current_turn && this.current_round ? this.current_round.indexOf(this.current_turn) : null
  }

  get current_round(): Round | null {
    return this.scoresheet.find((round, idx) => this.getCurrentTurnFromRound(round, idx) !== null) ?? null
  }

  get current_round_idx(): number | null {
    return this.current_round ? this.scoresheet.indexOf(this.current_round) : null
  }

  get dealer_idx(): number | null {
    return this.current_round_idx !== null ? (this.current_round_idx + this.players.length - 1) % this.players.length : null
  }

  get current_deal(): Deal | null {
    return this.current_round_idx !== null ? this.deals[this.current_round_idx] : null
  }

  get bids_left(): number {
    return (this.current_round && this.current_round.reduce((acc, curr_val) => {
      return acc + (curr_val.bid === null ? 1 : 0)
    }, 0)) ?? 0
  }

  get bid_options(): { number: number, disabled: boolean }[] {
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

  @action addPlayer = () => {
    if (this.players.length === 7) {
      // max cards in deck 52
      return
    }
    const max_id = Math.max(...this.players.map(p => p.id))
    this.players.push({ id: max_id + 1, name: `Player ${max_id + 2}` })
    this.scoresheet = getEmptyScoreSheet(this.players)
  }

  // TODO remove specific player
  @action removePlayer = () => {
    if (this.players.length === 2) {
      // min players is 2
      return
    }
    const new_p = [...this.players]
    new_p.pop()
    this.players = new_p
    this.scoresheet = getEmptyScoreSheet(this.players)
  }

  @action
  undo = () => {
    // TODO flip this around
    // start with the simplest case, same round and stage
    // if we need to wrap around, it's still the same round if the stage is score
    // if it's not score then we need to flip to bid and jump back a round

    // work out the round to undo first
    let round_to_undo = this.current_round
    let round_idx = this.current_round_idx!
    if (round_to_undo?.every(t => t.bid === null && t.score === null)) {
      round_idx -= 1
      round_to_undo = this.scoresheet[round_idx]
    }

    // back to the start
    if (!round_to_undo) {
      return
    }

    // work out who's turn it is, 0th player changes each round
    let turn = this.getCurrentTurnFromRound(round_to_undo, round_idx)
    if (!turn) {
      const last_player_idx = round_idx % this.players.length
      turn = round_to_undo[last_player_idx]
    }

    // get the previous turn idx
    let turn_idx = round_to_undo.indexOf(turn)
    turn_idx -= 1
    if (turn_idx < 0) {
      turn_idx = this.players.length - 1
    }

    // and the previous turn
    const turn_to_undo = round_to_undo[turn_idx]

    // work out which stage we're on
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
  setScoreForPlayer = (player_idx: number, tricks: number) => {
    if (this.current_round_idx === null) {
      return
    }
    let score = tricks
    const bid = this.scoresheet[this.current_round_idx][player_idx].bid
    if (bid === tricks) {
      score += 10
    }
    this.scoresheet[this.current_round_idx][player_idx].score = score
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
}

