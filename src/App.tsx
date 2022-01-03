import { Fragment, FunctionComponent, useEffect, useRef, useState } from 'react'
import { observer } from "mobx-react"
import { Link, Redirect, Route, Switch, useParams } from 'react-router-dom'

import { loadPlayers, loadScoresheet, Manager, Scoreboard } from './data'


const Root = observer(() => {
  const manager = useInstance(() => new Manager())

  const {
    newGame,
  } = manager

  if (!manager.games_loaded) {
    return null
  }

  return (
    <>
      <header className="flex items-baseline justify-between mt-px">
        <h1 className="font-mono text-sm">Contract whist</h1>
        <span className="space-x-2">
          <Link to={"/games"}><button className="border rounded-sm py-0.5 px-2 bg-indigo-100 border-indigo-900">All games</button></Link>
          <Link to={"/new_game"}><button className="border rounded-sm py-0.5 px-2 bg-indigo-100 border-indigo-900">New game</button></Link>
        </span>
      </header>
      <Switch>

        <Route path="/import/:uri" children={({ match }) => {
          const uri = match?.params.uri
          if (!uri) {
            return
          }
          const game = manager.importGame(uri)
          return <Redirect to={`/games/${game.uuid}`} />
        }}
        />

        <Route path="/new_game" children={() => {
          const game = newGame()
          return <Redirect to={`/games/${game.uuid}`} />
        }} />

        <Route path="/games/:uuid">
          <Game />
        </Route>

        <Route path={"/games"}>
          <ManageGames manager={manager} />
        </Route>

        <Route path="/">
          <Redirect to="/games" />
        </Route>
      </Switch>
    </>
  )
})

const ManageGames: FunctionComponent<{ manager: Manager }> = observer(({ manager }) => {

  // bit of a hack to make sure the scores stay up to date on this page
  useEffect(() => {
    manager.updateHighlightScores()
  }, [])

  return (
    <div className="text-sm overflow-scroll">
      {Array.from(manager.highlight_scores.entries())
        .sort(([a_uuid, a_data], [b_uuid, b_data]) => b_data.created_at.getTime() - a_data.created_at.getTime())
        .map(([uuid, data]) => {
          return (
            <div key={uuid} className="p-1">
              <div className="flex justify-between">
                <span>{data.created_at.toLocaleString()}</span>
                <Link to={`/games/${uuid}`}><button className="border rounded-sm py-0.5 px-2 bg-indigo-100 border-indigo-900">Load game</button></Link>
              </div>
              <div className={`grid grid-cols-${data.players.length}`} style={{ gridTemplateColumns: `repeat(${data.players.length}, minmax(0, 1fr))` }}>
                {data.players.map((p, idx) => <div key={idx}>{p.name}</div>)}
                {data.scores.map((s, idx) => <div key={idx} className={`${Math.max(...data.scores) === s && s > 0 ? 'bg-green-500' : ''}`}>{s}</div>)}
              </div>
            </div>
          )
        })}
    </div>
  )
})

const Game = observer(() => {
  const { uuid } = useParams<{ uuid: string }>()

  const [scoreboard, setScoreboard] = useState<Scoreboard | null>(null)

  useEffect(() => {
    if (!uuid) {
      // should always be a uuid in here
      return
    }
    loadPlayers(uuid)
      .then(players => {
        loadScoresheet(uuid, players)
          .then(scoresheet => {
            const scoreboard = new Scoreboard(uuid, scoresheet, players)
            setScoreboard(scoreboard)
          })
      })
  }, [uuid])

  const shareGame = () => {
    if (!scoreboard) {
      return
    }
    const data = {
      players: scoreboard.players,
      scoresheet: scoreboard.scoresheet
    }
    const uri = '/import/' + encodeURIComponent(btoa(JSON.stringify(data)))
    try {
      navigator.share({ url: uri })
    } catch (err) {
      const type = "text/plain"
      const blob = new Blob([location.host + uri], { type })
      const data = [new ClipboardItem({ [type]: blob })]
      navigator.clipboard.write(data)
    }
  }

  if (!scoreboard) {
    return null
  }

  const {
    deals,
    players,
    current_turn_idx: current_player,
    current_round_idx,
    scoresheet,
    stage,
    scores,
    undo,
    addPlayer,
    removePlayer
  } = scoreboard

  return (
    <>
      <div className="flex justify-end space-x-2 px-1 my-1">
        <button className="border rounded-sm py-0.5 px-2 bg-indigo-100 border-indigo-900" onClick={addPlayer}>Add player</button>
        <button className="border rounded-sm py-0.5 px-2 bg-indigo-100 border-indigo-900" onClick={removePlayer}>Remove player</button>
        <button className="border rounded-sm py-0.5 px-2 bg-indigo-100 border-indigo-900" onClick={shareGame}>Share</button>
        <button className="border rounded-sm py-0.5 px-2 bg-indigo-100 border-indigo-900" onClick={undo}>Undo</button>
      </div>
      <div className={`grid grid-cols-${players.length + 1} flex-grow`} style={{ gridTemplateColumns: `repeat(${players.length + 1}, minmax(0, 1fr))` }}>
        <div></div>
        {players.map(p => (
          <Player id={p.id} key={p.id} db={scoreboard} />
        ))}

        {deals.map((t, t_idx) => (
          <Fragment key={t_idx}>
            <div className={`flex items-center pl-2`}>
              <div className="font-semibold text-lg w-3 text-center">
                {t.num_cards}
              </div>
              <span className={`${t.suit_colour} text-xl w-6 text-center`}>
                {t.suit}
              </span>
            </div>

            {players.map((p, p_idx) => {
              return (
                <div key={p.id} className={`text-xl border-b ${p_idx % scoreboard.players.length === scoreboard.players.length - 1 ? '' : 'border-r'} border-gray-400 flex justify-center items-center text-center`}>
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
          <button
            key={opt.number}
            onClick={() => handleClick(opt)}
            className={`${opt.disabled ? 'border-purple-50 bg-white opacity-50' : 'border-gray-900 bg-indigo-100'} border rounded-sm  py-2 flex-1 m-0.5`}>
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
    bid_options
  } = db

  const setTricksMade = (tricks: number) => {
    if (current_player !== null) {
      setScoreForPlayer(current_player, tricks)
    }
  }

  return (
    <div className="flex justify-between w-full">
      {bid_options.map(opt => {
        return (
          <button
            key={opt.number}
            onClick={() => setTricksMade(opt.number)}
            className='border-gray-900 bg-indigo-100 border rounded-sm py-2 flex-1 m-0.5'>
            {opt.number}
          </button>
        )
      })}
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
    changePlayer(id, temp_name)
    setChangingName(false)
  }

  return (
    <div className={`${dealer_idx === id ? 'bg-red-500' : ''} text-center text-xs`}>
      {changing_name ?
        <input className="w-full h-full text-center" ref={input} value={temp_name} onChange={e => changeTempName(e.target.value)} onBlur={handleChangePlayer} />
        :
        <button onFocus={() => setChangingName(true)} className="w-full h-full p-1 truncate" onClick={() => setChangingName(true)}>{name ? name : 'Add player'}</button>
      }
    </div>
  )
}


function useInstance<T>(instanceFunc: () => T) {
  const ref = useRef<T | null>(null)
  if (ref.current === null) {
    ref.current = instanceFunc()
  }
  return ref.current
}

export default Root