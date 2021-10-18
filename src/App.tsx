import { Fragment, FunctionComponent, useEffect, useRef, useState } from 'react'
import { observer } from "mobx-react"
import { Route, Switch, useParams } from 'react-router-dom'

import { Manager, Scoreboard } from './data'

function useInstance<T>(instanceFunc: () => T) {
  const ref = useRef<T | null>(null)
  if (ref.current === null) {
    ref.current = instanceFunc()
  }
  return ref.current
}

export const Root = observer(() => {
  const manager = useInstance(() => new Manager())
  return (
    <Switch>
      <Route path={["/", "/:uri"]}>
        <MiddleMan manager={manager} />
      </Route>
    </Switch>
  )
})

const MiddleMan: FunctionComponent<{ manager: Manager }> = observer(({ manager }) => {
  const { uri } = useParams<{ uri?: string }>()

  const {
    importGame,
    loadMostRecentGame
  } = manager

  useEffect(() => {
    if (!manager.games_loaded) {
      return
    }
    if (uri) {
      importGame(uri)
      return
    }
    return (
      loadMostRecentGame()
    )

  }, [uri, manager.games_loaded])

  const scoreboard = manager.current_scoreboard
  if (!scoreboard || !manager.games_loaded) {
    return null
  }

  return <App manager={manager} scoreboard={scoreboard} />
})


const App: FunctionComponent<{ manager: Manager, scoreboard: Scoreboard }> = observer(({ manager, scoreboard }) => {

  const {
    deals,
    players,
    current_turn_idx: current_player,
    current_round_idx,
    stage,
    scoresheet,
    scores,
    undo
  } = scoreboard

  const {
    newGame
  } = manager

  const handleNewGame = () => {
    if (confirm('Are ya sure?')) {
      newGame()
    }
  }
  const share = () => {
    const uri = encodeURIComponent(btoa(JSON.stringify(scoresheet)))
    navigator.share({ url: uri })

  }

  return (
    <>
      <header className="flex justify-between p-1">
        <h1 className="text-lg font-semibold font-serif text-left my-2 inline-block">Contract whist</h1>
        {/* <button className="border px-2" onClick={share}>Share</button> */}
        <button className="border px-2" onClick={undo}>Undo</button>
        <button className="border px-2" onClick={handleNewGame}>New game</button>
      </header>
      <div className="grid grid-cols-5 flex-grow">
        <div></div>
        {players.map(p => (
          <Player id={p.id} key={p.id} db={scoreboard} />
        ))}

        {deals.map((t, t_idx) => (
          <Fragment key={t_idx}>
            <div className="flex items-center pl-2">
              <div className="font-semibold text-lg w-3 text-center">
                {t.num_cards}
              </div>
              <span className={`${t.suit_colour} text-xl w-6 text-center`}>
                {t.suit}
              </span>
            </div>

            {players.map((p, p_idx) => {
              return (
                <div key={p.id} className={`text-xl border-b ${p_idx % 4 === 3 ? '' : 'border-r'} border-gray-400 flex justify-center items-center text-center`}>
                  <div className={`${current_player === p_idx && current_round_idx === t_idx && stage === 'bid' ? 'bg-green-300' : ''} h-full flex items-center justify-center flex-grow w-full border-r`}>
                    {scoresheet[t_idx][p_idx].bid}
                  </div>
                  <div className={`${current_player === p_idx && current_round_idx === t_idx && stage === 'score' ? 'bg-green-300' : ''} h-full flex items-center justify-center flex-grow w-full `}>
                    {scoresheet[t_idx][p_idx].score}
                  </div>
                </div>
              )
            })}
          </Fragment>
        ))}

        <div className="text-center">Totals</div>
        {scores.map((s, idx) => {
          return <div key={idx} className="text-xl text-center border-r border-gray-400 last:border-r-0 ">{s}</div>
        })}

      </div>

      {stage === 'bid' &&
        <BidStage db={scoreboard} />
      }

      {stage === 'score' &&
        <ScoreStage db={scoreboard} />
      }

    </>
  )
})

const BidStage: FunctionComponent<{ db: Scoreboard }> = ({ db }) => {
  const {
    current_turn_idx: current_player,
    setBidForPlayer,
    bid_options
  } = db

  const handleClick = (opt: { number: number, disabled: boolean }) => {
    if (!opt.disabled && current_player !== null) {
      setBidForPlayer(current_player, opt.number)
    }
  }
  return (
    <div className="flex justify-between w-full">
      {bid_options.map(opt => {
        return (
          <button key={opt.number} onClick={() => handleClick(opt)} className={`${opt.disabled ? 'opacity-50' : ''} border border-gray-900 py-2 flex-grow m-1`}>
            {opt.number}
          </button>
        )
      })}
    </div>
  )
}

const ScoreStage: FunctionComponent<{ db: Scoreboard }> = ({ db }) => {

  const {
    current_turn_idx: current_player,
    setScoreForPlayer,
  } = db

  const setMadeIt = (made_it: boolean) => {
    if (current_player !== null) {
      setScoreForPlayer(current_player, made_it)
    }
  }

  return (
    <div className="flex">
      <button className="flex-grow border border-gray-900 py-2 m-1" onClick={() => setMadeIt(false)}>Failed</button>
      <button className="flex-grow border border-gray-900 py-2 m-1" onClick={() => setMadeIt(true)}>Made it</button>
    </div>
  )
}

const Player: FunctionComponent<{ db: Scoreboard, id: number }> = ({ db, id }) => {
  const {
    players,
    dealer_idx,
    changePlayer,
  } = db
  const name = players[id].name


  const [temp_name, changeTempName] = useState('')
  const [changing_name, setChangingName] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (input.current) {
      input.current.select()
    }
  }, [changing_name])

  const handleChangePlayer = e => {
    if (temp_name.trim()) {
      changePlayer(id, temp_name)
      setChangingName(false)
      return
    }
    input.current?.select()
  }

  return (
    <div className={`${dealer_idx === id ? 'bg-red-500' : ''} text-center text-sm`}>
      {changing_name ?
        <input className="w-full h-full text-center" ref={input} value={temp_name} onChange={e => changeTempName(e.target.value)} onBlur={handleChangePlayer} />
        :
        <button className="w-full h-full border p-1 truncate" onClick={() => setChangingName(true)}>{name ? name : 'Add player'}</button>
      }
    </div>
  )
}


export default App