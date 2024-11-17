import { Autocomplete, AutocompleteOption, Button } from "@mui/joy";
import { enqueueSnackbar } from "notistack";
import { useState } from "react";
import { db } from "../db";
import { queryAllPlayers } from "../queries";
import { Player } from "../types";

export const ChoosePlayerOrCreate = ({
  createPlayer,
  choosePlayer,
  excludedPlayerIds,
}: {
  createPlayer: (name: string) => Promise<void>;
  choosePlayer: (id: string) => Promise<void>;
  excludedPlayerIds: (string | undefined)[];
}) => {
  const {
    data: allPlayers,
    isLoading: isLoadingAllPlayers,
    error: errorPlayers,
  } = db.useQuery(queryAllPlayers);

  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [inputValue, setInputValue] = useState("");

  const handleChange = (
    event,
    newValue: Player | null | string,
    reason,
    details
  ) => {
    if (typeof newValue === "string") {
      throw Error("Not implemented");
    }
    setSelectedPlayer(newValue);
  };

  const handleAddPlayer = async (type: "new" | "existing") => {
    if (type === "new") {
      if (!inputValue.length) {
        enqueueSnackbar("Name is required", { variant: "error" });
        return;
      }

      await createPlayer(inputValue);
      setInputValue("");
      setSelectedPlayer(null);
      return;
    }

    if (!selectedPlayer) {
      enqueueSnackbar("Player is required", { variant: "error" });
      return;
    }
    await choosePlayer(selectedPlayer.id);
    setSelectedPlayer(null);
  };

  const options =
    allPlayers?.players
      .filter((p) => !excludedPlayerIds.includes(p.id))
      .map(
        (p) =>
          ({
            id: p.id,
            name: p.name as any,
          } as Player)
      ) ?? [];

  const hasOptions = !!options.find(
    (o) => o.name.trim().toLowerCase() === inputValue.trim().toLowerCase()
  );

  return (
    <Autocomplete<Player, false, true, true>
      sx={{ flexGrow: 1 }}
      size="md"
      slotProps={{
        input: {
          "data-1p-ignore": true,
        },
      }}
      freeSolo
      disableClearable
      handleHomeEndKeys
      placeholder="Type to create player or choose existing"
      autoFocus
      value={selectedPlayer ?? ""}
      onChange={handleChange}
      inputValue={inputValue}
      onInputChange={(event, newInputValue) => {
        setInputValue(newInputValue);
      }}
      endDecorator={
        !hasOptions && inputValue ? (
          <Button onClick={() => handleAddPlayer("new")}>Create</Button>
        ) : selectedPlayer ? (
          <Button onClick={() => handleAddPlayer("existing")}>Choose</Button>
        ) : null
      }
      isOptionEqualToValue={(o, v) => o.id === v.id}
      options={options}
      getOptionLabel={(option) => {
        if (typeof option === "string") {
          return option;
        }
        return option.name;
      }}
      renderOption={(props, option) => (
        <AutocompleteOption {...props} key={option.id}>
          {option.name}
        </AutocompleteOption>
      )}
    />
  );
};
