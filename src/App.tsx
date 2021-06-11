import { Fragment, FunctionComponent, useEffect, useRef, useState } from 'react'
import { observer } from "mobx-react"


import { DB } from './data'


const App: FunctionComponent<{ db: DB }> = observer(({ db }) => {
  if (!db.scoresheet.size) {
    return null
  }

  const handleNewGame = () => {
    if (confirm('Are ya sure?')) {
      db.newGame()
    }
  }
  console.log(db.stage, db.current_player)
  return (
    <div className="bg-gray-100">
      <header className="flex justify-between p-1">
        <h1 className="text-lg font-semibold font-serif text-left my-2 inline-block">Contract whist</h1>
        <button className="border px-2" onClick={handleNewGame}>New game</button>
      </header>
      <div className="grid grid-cols-5">
        <div></div>
        {Array.from(db.players.values()).map(p => (
          <Player id={p.id} key={p.id} db={db} />
        ))}

        {Array.from(db.turns.values()).map(t => (
          <Fragment key={t.id}>
            <div className="flex items-baseline"><div className="inline-block pl-1 w-2 text-center font-semibold align-middle">{t.num_cards}</div>&nbsp;<div className={`${t.suit_colour} w-5 h-6 pt-0.5 align-middle inline-block text-center`}>{t.suit}</div></div>
            {Array.from(db.players.values()).map(p => {
              return (
                <div key={p.id} className="border-b border-r last:border-r-0 text-right flex relative justify-between items-center">
                  <div className={`${db.current_player == p.id && db.current_turn.id == t.id && db.stage === 'bid' ? 'bg-green-300' : ''} h-full flex-grow w-7 border-r`}>{db.scoresheet.get(t.id)[p.id].bid}</div>
                  <div className={`${db.current_player == p.id && db.current_turn.id == t.id && db.stage === 'score' ? 'bg-green-300' : ''}  h-full flex-grow w-7 `}>{db.scoresheet.get(t.id)[p.id].score}</div>
                </div>
              )
            })}
          </Fragment>
        ))}

        <div>Totals</div>
        {db.scores.map(s => {
          return <div className="text-center">{s}</div>
        })}

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
    if (curr_bid !== null) {
      db.setBidForPlayer(db.current_player, curr_bid)
      setCurrBid(null)
    }
  }
  const handleClick = (opt: number) => {
    setCurrBid(opt)
  }
  console.log(db.bid_options)
  return (<>
    <div className="text-center">
      Bid
    </div>
    <div className="flex justify-between w-full">
      {db.bid_options.map(opt => <button key={opt} onClick={() => handleClick(opt)} className={`${curr_bid === opt ? 'bg-green-300' : ''} border py-2 flex-grow m-1`}>{opt}</button>)}
    </div>
    <div className="flex">
      <button disabled={curr_bid === null} className="flex-grow border py-2 m-1" onClick={() => setCurrBid(null)}>Cancel</button>
      <button disabled={curr_bid === null} className="flex-grow border py-2 m-1" onClick={handleConfirm}>Confirm</button>
    </div>
  </>)
}

const ScoreStage = ({ db }) => {
  const [made_it, setMadeIt] = useState(null)

  const handleConfirm = () => {
    if (made_it !== null) {
      db.setScoreForPlayer(db.current_player, made_it)
      setMadeIt(null)
    }
  }

  return (<>
    <div className="text-center">
      Made it?
    </div>
    <div className="flex">
      <button className={`flex-grow border py-2 m-1 ${made_it === false ? 'bg-green-300' : ''} `} onClick={() => setMadeIt(false)}>No</button>
      <button className={`flex-grow border py-2 m-1 ${made_it === true ? 'bg-green-300' : ''}`} onClick={() => setMadeIt(true)}>Yes</button>
    </div>
    <div className="flex">
      <button className="flex-grow border py-2 m-1" onClick={() => setMadeIt(null)}>Cancel</button>
      <button className="flex-grow border py-2 m-1" onClick={handleConfirm}>Confirm</button>
    </div>
  </>)
}

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
    <div className={`${db.current_dealer === id ? 'bg-red-500' : ''} text-center`}>
      {changing_name ?
        <input className="w-full h-full text-center" ref={input} value={temp_name} onChange={e => changeTempName(e.target.value)} onBlur={handleChangePlayer} />
        :
        <button className="w-full h-full border p-1 truncate" onClick={() => setChangingName(true)}>{name ? name : 'Add player'}</button>
      }
    </div>
  )
}


export default App