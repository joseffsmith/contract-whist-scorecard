import { FunctionComponent, useEffect, useRef, useState } from 'react'
import { DB } from './data'

import './index.css'
import { observer } from "mobx-react"


const App: FunctionComponent<{ db: DB }> = observer(({ db }) => {

  const players = db.players

  const handleRemovePlayer = (name: string) => {
    // db.removePlayer(name)
  }


  return (
    <div className="bg-gray-100">
      <h1 className="text-lg font-semibold font-serif text-center my-4">Contract whist</h1>
      <div className="grid grid-cols-5">
        <div></div>
        <Player id={1} key={1} db={db} />
        <Player id={2} key={2} db={db} />
        <Player id={3} key={3} db={db} />
        <Player id={4} key={4} db={db} />

        {Array.from(db.turns.values()).map(t => {
          return <>
            <div><div className="inline-block w-4 text-center">{t.num_cards}</div>&nbsp;<div className={`${t.suit_colour} w-4 inline-block text-center`}>{t.suit}</div></div>
            <div></div>
            <div></div>
            <div></div>
            <div></div>
          </>
        })}
      </div>
    </div>
  )
})
export default App

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
    console.log(temp_name)
    if (temp_name.trim()) {
      db.changePlayer(id, temp_name)
      setChangingName(false)
      return
    }
    input.current.focus()
  }


  return (
    <div>
      {changing_name ?
        <input className="w-full" ref={input} value={temp_name} onChange={e => changeTempName(e.target.value)} onBlur={handleChangePlayer} />
        :
        <button className="border p-1" onClick={() => setChangingName(true)}>{name ? name : 'Add player'}</button>
      }
    </div>
  )
}


