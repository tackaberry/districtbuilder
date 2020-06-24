const districtColors = [
  "transparent",
  "#9f4d51",
  "#45ce5b",
  "#9445c4",
  "#69b426",
  "#4d52c7",
  "#aec334",
  "#6571ee",
  "#82c852",
  "#b473ee",
  "#3c9c2e",
  "#d238a0",
  "#37b762",
  "#f23d86",
  "#49c890",
  "#a743a8",
  "#76ca72",
  "#774eb8",
  "#d0b93b",
  "#5467ca",
  "#e8ac37",
  "#5c51b1",
  "#8ba433",
  "#7189ef",
  "#e58d22",
  "#548de0",
  "#e6692b",
  "#4cbee0",
  "#da3d2d",
  "#51d1c6",
  "#e23c54",
  "#47b192",
  "#c12361",
  "#5ba14f",
  "#e271ce",
  "#477d21",
  "#c881dc",
  "#2f7737",
  "#e65d9e",
  "#56a06c",
  "#e04676",
  "#368a63",
  "#ab367d",
  "#97ba6d",
  "#6c4a9d",
  "#b3a03b",
  "#8c4ea0",
  "#5d7018",
  "#937cc8",
  "#897916",
  "#3464ab",
  "#e8a04f",
  "#5f589c",
  "#b98225",
  "#3f8bbf",
  "#ac3a18",
  "#319c9a",
  "#b12d3b",
  "#81c49b",
  "#ab375a",
  "#306a3c",
  "#c39fe3",
  "#616117",
  "#80a2e0",
  "#d75f3b",
  "#115e41",
  "#d5605b",
  "#25735a",
  "#d66a8a",
  "#6e8f4b",
  "#85518e",
  "#bdb26f",
  "#5d679c",
  "#b56522",
  "#b36d9e",
  "#4d662b",
  "#e793c0",
  "#705d18",
  "#964168",
  "#878745",
  "#894b67",
  "#dca371",
  "#62612c",
  "#ea7e85",
  "#865e1c",
  "#d88884",
  "#9f8146",
  "#9d4a2d",
  "#e88965",
  "#89562c",
  "#ae7548"
];

export const getDistrictColor = (id?: string | number) => {
  const index = typeof id === "number" ? id : 0;

  // Cycle through the list in case there are a very large number of districts
  return districtColors[index % districtColors.length];
};
