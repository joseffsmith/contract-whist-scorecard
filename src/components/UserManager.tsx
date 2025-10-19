import { Button, Typography } from "@mui/joy";
import { db } from "../db";
import { LinkPlayerToMe, UserLogin } from "./UserLogin";

export const UserManager = () => {
  const { isLoading: isLoadingUser, user, error } = db.useAuth();

  const { data: playerData, isLoading: isLoadingPlayerData } = db.useQuery(
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

  const handleLogout = () => {
    db.auth.signOut();
  };

  const handleUnlink = async (playerId: string, userId: string) => {
    await db.transact([
      db.tx.players[playerId].unlink({ $user: userId }),
      db.tx.players[playerId].merge({ isLinked: false }),
    ]);
  };

  if (isLoadingUser) {
    return <div className="text-gray-900 dark:text-gray-100">Loading user...</div>;
  }
  if (!user) {
    return <UserLogin />;
  }
  if (isLoadingPlayerData) {
    return <div className="text-gray-900 dark:text-gray-100">Loading...</div>;
  }
  const linkedPlayer = playerData?.players[0];

  return (
    <div className="p-2 space-y-2">
      <Typography level="title-sm">Email</Typography>
      <Typography level="body-lg">{user?.email}</Typography>

      <Button onClick={handleLogout}>Logout</Button>

      <Typography level="title-sm">Username</Typography>
      {linkedPlayer ? (
        <>
          <Typography level="body-lg">{linkedPlayer.name}</Typography>
          <Button onClick={() => handleUnlink(linkedPlayer.id, user.id)}>
            Unlink
          </Button>
        </>
      ) : (
        <LinkPlayerToMe />
      )}
    </div>
  );
};
