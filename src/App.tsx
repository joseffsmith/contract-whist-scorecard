import React, { FunctionComponent, useState } from 'react'
import { DB } from './data'

import './index.css'
import { observer } from "mobx-react"

const App: FunctionComponent<{ db: DB }> = observer(({ db }) => {

  const players = db.players

  const handleRemovePlayer = (name: string) => {
    db.removePlayer(name)
  }
  return (
    <div className="bg-gray-50">
      <AddPlayer db={db} />
      <ul>
        {players.map(p => {
          return (
            <li key={p.name}>{p.name} <button onClick={() => handleRemovePlayer(p.name)}>X</button></li>
          )
        })}
      </ul>
    </div>
  )
})


const AddPlayer: FunctionComponent<{ db: DB }> = ({ db }) => {
  const [name, setName] = useState('')

  const handleAddPlayer = e => {
    if (db.players.find(p => p.name === name)) {
      alert('Player with name already exists')
      return
    }
    if (name.trim()) {
      db.addPlayer(name)
      setName('')
    }
  }
  return (
    <div>
      <input value={name} onChange={e => setName(e.target.value)} />
      <button onClick={handleAddPlayer}>Add</button>
    </div>
  )
}

export default App
