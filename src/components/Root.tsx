import { observer } from 'mobx-react'
import { Link, Redirect, Route, Switch } from 'react-router-dom'

import { useManager } from './App'
import { Game } from './Game'
import { ManageGames } from './ManageGames'


export const Root = observer(() => {
  const manager = useManager()

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

        <Route path="/new_game" children={() => {
          const game = newGame()
          return <Redirect to={`/games/${game.uuid}`} />
        }} />

        <Route path="/games/:uuid">
          <Game />
        </Route>

        <Route path={"/games"}>
          <ManageGames />
        </Route>

        <Route path="/">
          <Redirect to="/games" />
        </Route>
      </Switch>
    </>
  )
})
