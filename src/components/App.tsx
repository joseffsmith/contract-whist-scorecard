import {
  Button,
  Container,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormLabel,
  Input,
  Modal,
  ModalDialog,
  Stack,
  TextField,
  Typography,
} from "@mui/joy";
import { SnackbarProvider, enqueueSnackbar } from "notistack";

import { useState } from "react";
import { Link, Outlet, useNavigate, useParams } from "react-router-dom";
import { db } from "..";
import { id, tx } from "@instantdb/react";
import { DEALS } from "../constants";

export const App = () => {
  const { isLoading, user, error } = db.useAuth();

  // const { gameId } = useParams();
  const nav = useNavigate();

  // const [currentGame, loading, errors] = useObjectVal<Game>(
  //   ref(db, "games/" + gameId)
  // );
  // const [user, loading, error] = useAuthState(auth);

  // TODO: select players from previous game loaded
  async function createNewGame() {
    if (!user) {
      console.error("No user");
      enqueueSnackbar("No user", { variant: "error" });
      return;
    }
    const gameId = id();

    const rounds = DEALS.map((deal) => {
      return { id: id(), roundNumber: deal.id };
    });

    const res = await db.transact([
      tx.games[gameId].update({
        created_at: new Date().toISOString(),
      }),
      ...rounds.map((round) => {
        return tx.rounds[round.id]
          .update({
            roundNumber: round.roundNumber,
          })
          .link({ game: gameId });
      }),
    ]);

    if (res.status === "enqueued") {
      enqueueSnackbar("Game enqueued", { variant: "success" });
    }
    if (res.status === "synced") {
      enqueueSnackbar("Game synced", { variant: "success" });
    }

    console.log("clientid:, ", res.clientId);
    console.log("gameID:, ", gameId);
    nav("/games/" + gameId);
  }

  if (isLoading) {
    return <div>Loading...</div>;
  }
  if (error) {
    return <div>Uh oh! {error.message}</div>;
  }
  if (!user) {
    return <Login />;
  }

  return (
    <div className="bg-gray-100 fixed inset-0 pb-8 flex flex-col overscroll-y-none max-w-xl max-h-[800px] m-auto">
      <header className="flex items-baseline justify-between mt-px">
        <h1 className="font-mono text-sm">Contract whist</h1>
        <span className="space-x-2">
          <Link to={"/"}>
            <button className="border rounded-sm py-0.5 px-2 bg-indigo-100 border-indigo-900">
              All games
            </button>
          </Link>

          <button
            onClick={createNewGame}
            className="border rounded-sm py-0.5 px-2 bg-indigo-100 border-indigo-900"
          >
            New game
          </button>
          <button
            onClick={() => console.error("Impl")}
            className="border rounded-sm py-0.5 px-2 bg-indigo-100 border-indigo-900"
          >
            Join game
          </button>
        </span>
      </header>
      <Outlet />
    </div>
  );
};

function Login() {
  const [sentEmail, setSentEmail] = useState("");
  return (
    <Modal open component={"div"}>
      <ModalDialog>
        <DialogTitle>Log in</DialogTitle>
        {!sentEmail ? (
          <Email setSentEmail={setSentEmail} />
        ) : (
          <MagicCode sentEmail={sentEmail} />
        )}
      </ModalDialog>
    </Modal>
  );
}

function Email({ setSentEmail }) {
  const [email, setEmail] = useState("");

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!email) return;
    setSentEmail(email);
    db.auth.sendMagicCode({ email }).catch((err) => {
      alert("Uh oh :" + err.body?.message);
      setSentEmail("");
    });
  };

  return (
    <>
      <form onSubmit={handleSubmit}>
        <DialogContent>
          <Typography>Let's log you in!</Typography>
          <FormControl>
            <FormLabel>Email</FormLabel>
            <Input
              placeholder="Enter your email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button type="submit">Send Code</Button>
        </DialogActions>
      </form>
    </>
  );
}

function MagicCode({ sentEmail }) {
  const [code, setCode] = useState("");

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    db.auth.signInWithMagicCode({ email: sentEmail, code }).catch((err) => {
      alert("Uh oh :" + err.body?.message);
      setCode("");
    });
  };

  return (
    <>
      <form onSubmit={handleSubmit}>
        <DialogContent>
          <Typography>
            Okay, we sent you an email! What was the code?
          </Typography>
          <Input
            type="text"
            placeholder="123456..."
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button type="submit">Verify</Button>
        </DialogActions>
      </form>
    </>
  );
}