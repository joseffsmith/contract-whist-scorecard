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
                $user: user?.id!,
              },
            },
          },
        }
      : null
  );

  if (user && !playerUser?.players?.length) {
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
      enqueueSnackbar<"error">("Uh oh :" + err.body?.message, {
        variant: "error",
      });
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
              name="email"
              slotProps={{
                input: {
                  "data-1p-ignore": true,
                },
              }}
              autoComplete="email"
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
  const nav = useNavigate()

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    db.auth.signInWithMagicCode({ email: sentEmail, code })
      .catch((err) => {
        alert("Uh oh :" + err.body?.message);
        setCode("");
      })
      .then((val) => {
        console.log("Signed in!", val);
        // Navigate to the home page or dashboard
        nav("/");
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
            id="verification-code"
            name="verification-code"
            autoComplete="one-time-code"
            placeholder="123456..."
            value={code}
            inputMode="numeric"
            slotProps={{
              input: {
                pattern: "[0-9]*",
                "data-1p-ignore": true,
              },
            }}
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

export const LinkPlayerToMe = () => {
  const { user } = db.useAuth();
  const { data } = db.useQuery({
    players: {
      $user: {},
    },
  });

  // Exclude players that are already linked to any user
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
        .link({ $user: user.id }),
    ]);
  };

  const choosePlayer = async (id: string) => {
    if (!user) {
      throw Error("No user");
    }
    await db.transact([db.tx.players[id].link({ $user: user.id })]);
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
