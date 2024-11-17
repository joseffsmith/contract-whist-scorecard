import { id } from "@instantdb/react";
import {
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormLabel,
  Input,
  Modal,
  ModalClose,
  ModalDialog,
  Typography,
} from "@mui/joy";
import { enqueueSnackbar } from "notistack";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../db";
import { ChoosePlayerOrCreate } from "./ChoosePlayerOrCreate";

export const UserLogin = () => {
  const nav = useNavigate();
  const [isLoginOpen, setIsLoginOpen] = useState(true);

  const handleClose = () => {
    setIsLoginOpen(false);
    nav(-1);
  };
  return <Login open={isLoginOpen} onClose={handleClose} />;
};

const Login = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { isLoading, user, error } = db.useAuth();

  const [sentEmail, setSentEmail] = useState("");

  const { isLoading: isLoadingPlayerUser, data: playerUser } = db.useQuery(
    user
      ? {
          players: {
            $: {
              where: {
                user: user?.id!,
              },
            },
          },
        }
      : null
  );

  if (user && !playerUser?.players.length) {
    return <LinkPlayerToMe />;
  }

  return (
    <Modal open={open} component={"div"} onClose={onClose}>
      <ModalDialog>
        <ModalClose />
        <DialogTitle>Log in</DialogTitle>
        {!sentEmail ? (
          <Email setSentEmail={setSentEmail} />
        ) : (
          <MagicCode sentEmail={sentEmail} />
        )}
      </ModalDialog>
    </Modal>
  );
};

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
      db.tx.players[playerId]
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
    await db.transact([db.tx.players[id].link({ user: user.id })]);
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
