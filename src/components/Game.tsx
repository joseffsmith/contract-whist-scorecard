import { Fragment, FunctionComponent, useEffect, useRef, useState } from 'react'
import { observer } from "mobx-react"
import { useParams } from 'react-router-dom'

import { Scoreboard } from '../data/Scoreboard'
import { loadPlayers, loadScoresheet } from '../data/helpers'


export const Game = observer(() => {
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

