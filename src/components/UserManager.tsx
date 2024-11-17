import { Typography } from "@mui/joy";
import { db } from "../db";
import { UserLogin } from "./UserLogin";

export const UserManager = () => {
  const { isLoading: isLoadingUser, user, error } = db.useAuth();

  const { data: playerData, isLoading: isLoadingPlayerData } = db.useQuery(
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
  if (isLoadingUser) {
    return <div>Loading user...</div>;
  }
  if (!user) {
    return <UserLogin />;
  }
  if (isLoadingPlayerData) {
    return <div>Loading...</div>;
  }
  return (
    <div className="p-2 space-y-2">
      <Typography level="title-sm">Email</Typography>
      <Typography level="body-lg">{user?.email}</Typography>

      <Typography level="title-sm">Username</Typography>
      <Typography level="body-lg">{playerData?.players[0].name}</Typography>
    </div>
  );
};
