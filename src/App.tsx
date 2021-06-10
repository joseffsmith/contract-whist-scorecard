import { FunctionComponent, useEffect, useRef, useState } from 'react'
import { DB } from './data'

import './index.css'
import { observer } from "mobx-react"
import { toJS } from 'mobx'


const App: FunctionComponent<{ db: DB }> = observer(({ db }) => {
  if (!db.scoresheet.size) {
    return null
  }
  const players = db.players

  const round_id = db.current_round
  return (
    <div className="bg-gray-100">
      <h1 className="text-lg font-semibold font-serif text-center my-4">Contract whist</h1>
      <div className="grid grid-cols-5">
        <div></div>
        {Array.from(players.values()).map(p => (
          <Player id={p.id} key={p.id} db={db} />
        ))}

        {Array.from(db.turns.values()).map(t => (
          <>
            <div key={`${t.id}-0`}><div className="inline-block pl-1 w-2 text-center font-semibold">{t.num_cards}</div>&nbsp;<div className={`${t.suit_colour} w-5 inline-block text-center`}>{t.suit}</div></div>
            {Array.from(players.values()).map(p => <div key={`${t.id}-${p.id}`} className="border-b border-r last:border-r-0 text-right">{db.scoresheet.get(t.id)[p.id].bid} | {db.scoresheet.get(t.id)[p.id].score}</div>)}
          </>
        ))}
      </div>
      {db.stage === 'bid' &&
        <BidStage db={db} />
      }

      {db.stage === 'score' &&
        <ScoreStage db={db} />
      }

    </div>
  )
})

const BidStage: FunctionComponent<{ db: DB }> = ({ db }) => {
  const [curr_bid, setCurrBid] = useState(null)

  const handleConfirm = () => {
    db.setBidForPlayer(db.current_player, curr_bid)
  }
  const handleClick = (opt: number) => {
    setCurrBid(opt)
  }
  return (<>
    <div className="flex justify-between w-full">
      {db.bid_options.map(opt => <button key={opt} onClick={() => handleClick(opt)} className={`${curr_bid === opt ? 'bg-green-300' : ''} border py-2 flex-grow m-1`}>{opt}</button>)}
    </div>
    <div className="flex">
      <button disabled={curr_bid === null} className="flex-grow border" onClick={() => setCurrBid(null)}>Cancel</button>
      <button disabled={curr_bid === null} className="flex-grow border" onClick={handleConfirm}>Confirm</button>
    </div>
  </>)
}

const ScoreStage = ({ db }) => null

const Player: FunctionComponent<{ db: DB, id: number }> = ({ db, id }) => {
  const name = db.players?.get(id)?.name ?? null

  const [temp_name, changeTempName] = useState('')
  const [changing_name, setChangingName] = useState(false)
  const input = useRef(null)

  useEffect(() => {
    if (input.current) {
      input.current.select()
    }
  }, [changing_name])

  const handleChangePlayer = e => {
    if (temp_name.trim()) {
      db.changePlayer(id, temp_name)
      setChangingName(false)
      return
    }
    input.current.select()
  }

  return (
    <div className="text-center">
      {changing_name ?
        <input className="w-full" ref={input} value={temp_name} onChange={e => changeTempName(e.target.value)} onBlur={handleChangePlayer} />
        :
        <button className="border p-1" onClick={() => setChangingName(true)}>{name ? name : 'Add player'}</button>
      }
    </div>
  )
}


export default App