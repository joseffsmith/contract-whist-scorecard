import { id, tx } from "@instantdb/react";
import AddIcon from "@mui/icons-material/Add";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";
import UpdateIcon from "@mui/icons-material/Update";
import {
  Avatar,
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormLabel,
  Input,
  List,
  ListItem,
  ListItemButton,
  ListItemDecorator,
  Modal,
  ModalDialog,
  Typography,
} from "@mui/joy";
import { enqueueSnackbar } from "notistack";
import { useState } from "react";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { db } from "..";
import { DEALS } from "../constants";
import { addExistingPlayerToGame } from "../utils/addExistingPlayerToGame";
import { ChoosePlayerOrCreate } from "./ChoosePlayerOrCreate";
import img from "/android-chrome-192x192.png";

export const App = () => {
  const { isLoading, user, error } = db.useAuth();

  const nav = useNavigate();

  const { isLoading: isLoadingPlayerUser, data: playerUser } = db.useQuery({
    players: {
      $: {
        where: {
          user: user?.id!,
        },
      },
    },
  });

  async function createNewGame() {
    if (!user || !playerUser?.players.length) {
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
        createdAt: new Date().toISOString(),
        deletedAt: "",
        createdBy: user.id,
      }),

      ...rounds.map((round) => {
        return tx.rounds[round.id]
          .update({
            roundNumber: round.roundNumber,
          })
          .link({ game: gameId });
      }),
    ]);

    await addExistingPlayerToGame(gameId, playerUser.players[0].id, 0);

    nav("/games/" + gameId + "/manage");
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
  if (!playerUser?.players.length) {
    return <LinkPlayerToMe />;
  }
  const player = playerUser.players[0];

  return (
    <>
      <div className="bg-gray-100 fixed inset-0 pb-8 flex flex-col overscroll-y-none max-w-4xl max-h-[800px] m-auto">
        <List
          role="menubar"
          orientation="horizontal"
          size="md"
          sx={{
            flexGrow: 0,
            width: "100%",
            justifyContent: "space-between",
            px: 4,
          }}
        >
          <ListItem>
            <img src={img} alt="Logo" width="32" height="32" />
          </ListItem>
          {/* <ListDivider /> */}

          <ListItem role="none">
            <ListItemButton
              role="menuitem"
              component={Link}
              to={"/user"}
              aria-label="Home"
            >
              <Avatar>
                {player.name
                  .split(" ")
                  .map((i) => i[0])
                  .join("")
                  .toUpperCase()}
              </Avatar>
            </ListItemButton>
          </ListItem>
          {/* <ListDivider /> */}

          <ListItem>
            <ListItemButton
              role="menuitem"
              component={Link}
              to={"/leaderboard"}
            >
              <FormatListNumberedIcon />
            </ListItemButton>
          </ListItem>
          {/* <ListDivider /> */}
          <ListItem>
            <ListItemButton role="menuitem" component={Link} to={"/"}>
              <UpdateIcon />
            </ListItemButton>
          </ListItem>
          {/* <ListDivider /> */}
          <ListItem>
            <ListItemDecorator>
              <ListItemButton
                role="menuitem"
                onClick={createNewGame}
                // variant="solid"
              >
                <AddIcon />
              </ListItemButton>
            </ListItemDecorator>
          </ListItem>
        </List>

        <Outlet />
      </div>
    </>
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

const LinkPlayerToMe = () => {
  const { user } = db.useAuth();
  const { data } = db.useQuery({
    players: {
      $: {
        where: {
          isLinked: true,
        },
      },
    },
  });

  const excludedPlayerIds = data?.players.map((p) => p.id) ?? [];

  const createPlayer = async (name: string) => {
    if (!user) {
      throw Error("No user");
    }
    if (!name) {
      enqueueSnackbar("Name is required", { variant: "error" });
      return;
    }

    const playerId = id();
    await db.transact([
      tx.players[playerId]
        .update({
          name,
        })
        .link({ user: user.id }),
    ]);
  };

  const choosePlayer = async (id: string) => {
    if (!user) {
      throw Error("No user");
    }
    await db.transact([tx.players[id].link({ user: user.id })]);
  };

  return (
    <Modal open>
      <ModalDialog size="lg">
        <DialogTitle>Link player</DialogTitle>
        <DialogContent>
          <Typography>
            You need to link a player to your account before you can play.
          </Typography>
          <ChoosePlayerOrCreate
            createPlayer={createPlayer}
            choosePlayer={choosePlayer}
            excludedPlayerIds={excludedPlayerIds}
          />
        </DialogContent>
      </ModalDialog>
    </Modal>
  );
};
