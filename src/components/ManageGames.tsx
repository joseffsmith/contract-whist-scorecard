import { observer } from 'mobx-react'
import { FunctionComponent, useEffect } from 'react'
import { Link } from 'react-router-dom'

import { useManager } from './App'

export const ManageGames: FunctionComponent = observer(() => {

  const manager = useManager()
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