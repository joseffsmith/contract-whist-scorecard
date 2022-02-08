import { createContext, useContext } from 'react'
import { Manager } from '../data/Manager'

import { Root } from './Root'


const manager = new Manager()

const ManagerContext = createContext(manager)

const ManagerProvider = ({ children, store }) => (
  <ManagerContext.Provider value={store}>{children}</ManagerContext.Provider>
)

export const useManager = () => useContext(ManagerContext)

export const App = () => {
  return (
    <ManagerProvider store={manager}>
      <Root />
    </ManagerProvider>
  )
}
