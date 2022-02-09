export type Stage = 'bid' | 'score'

export type Turn = {
  bid: null | number,
  score: null | number
}

export type Round = Turn[]

export type Scoresheet = Round[]

export type Player = {
  id: number,
  name: string
}

export type Game = {
  uuid: string,
  created_at: Date
}

export type Deal = {
  id: number;
  num_cards: number;
  suit_colour: string;
  suit: string;
}