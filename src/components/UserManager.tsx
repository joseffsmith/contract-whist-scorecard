import { Divider, Grid, Typography } from "@mui/joy";
import { db } from "..";

export const UserManager = () => {
  const { isLoading, user, error } = db.useAuth();

  const { data: playerData } = db.useQuery({
    players: {
      $: {
        where: {
          user: user?.id!,
        },
      },
    },
  });
  return (
    <div className="p-2 space-y-2">
      <Typography level="title-sm">Email</Typography>
      <Typography level="body-lg">{user?.email}</Typography>

      <Typography level="title-sm">Username</Typography>
      <Typography level="body-lg">{playerData?.players[0].name}</Typography>
    </div>
  );
};
