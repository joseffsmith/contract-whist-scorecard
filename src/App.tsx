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
    <div className="bg-gray-100">
      <header className="flex justify-between p-1">
        <h1 className="text-lg font-semibold font-serif text-left my-2 inline-block">Contract whist</h1>
        <button className="border px-2" onClick={share}>Share</button>
        <button className="border px-2" onClick={undo}>Undo</button>
        <button className="border px-2" onClick={handleNewGame}>New game</button>
      </header>
      <div className="grid grid-cols-5">
        <div></div>
        {players.map(p => (
          <Player id={p.id} key={p.id} db={scoreboard} />
        ))}

        {deals.map((t, t_idx) => (
          <Fragment key={t_idx}>
            <div className="flex items-baseline">
              <div className="inline-block pl-1 w-2 text-center font-semibold align-middle">
                {t.num_cards}
              </div>&nbsp;
              <div className={`${t.suit_colour} w-5 h-6 pt-0.5 align-middle inline-block text-center`}>
                {t.suit}
              </div>
            </div>

            {players.map((p, p_idx) => {
              return (
                <div key={p.id} className="border-b border-r last:border-r-0 text-right flex relative justify-between items-center">
                  <div className={`${current_player === p_idx && current_round_idx === t_idx && stage === 'bid' ? 'bg-green-300' : ''} text-center h-full flex-grow w-7 border-r`}>
                    {scoresheet[t_idx][p_idx].bid}
                  </div>
                  <div className={`${current_player === p_idx && current_round_idx === t_idx && stage === 'score' ? 'bg-green-300' : ''} text-center h-full flex-grow w-7 `}>
                    {scoresheet[t_idx][p_idx].score}
                  </div>
                </div>
              )
            })}
          </Fragment>
        ))}

        <div>Totals</div>
        {scores.map((s, idx) => {
          return <div key={idx} className="text-center">{s}</div>
        })}

      </div>

      {stage === 'bid' &&
        <BidStage db={scoreboard} />
      }

      {stage === 'score' &&
        <ScoreStage db={scoreboard} />
      }

    </div>
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
    <>
      <div className="text-center">
        Bid
      </div>
      <div className="flex justify-between w-full">
        {bid_options.map(opt => {
          return (
            <button key={opt.number} onClick={() => handleClick(opt)} className={`${opt.disabled ? 'opacity-50' : ''} border py-2 flex-grow m-1`}>
              {opt.number}
            </button>
          )
        })}
      </div>
    </>
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
    <>
      <div className="text-center">
        Made it?
      </div>
      <div className="flex">
        <button className="flex-grow border py-2 m-1" onClick={() => setMadeIt(false)}>No</button>
        <button className="flex-grow border py-2 m-1" onClick={() => setMadeIt(true)}>Yes</button>
      </div>
    </>
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
    <div className={`${dealer_idx === id ? 'bg-red-500' : ''} text-center`}>
      {changing_name ?
        <input className="w-full h-full text-center" ref={input} value={temp_name} onChange={e => changeTempName(e.target.value)} onBlur={handleChangePlayer} />
        :
        <button className="w-full h-full border p-1 truncate" onClick={() => setChangingName(true)}>{name ? name : 'Add player'}</button>
      }
    </div>
  )
}


export default App