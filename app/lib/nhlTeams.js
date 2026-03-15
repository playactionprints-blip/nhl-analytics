export const TEAM_COLOR = {
  ANA: "#F47A38", BOS: "#FFB81C", BUF: "#003087", CAR: "#CC0000",
  CBJ: "#002654", CGY: "#C8102E", CHI: "#CF0A2C", COL: "#6F263D", DAL: "#006847",
  DET: "#CE1126", EDM: "#FF4C00", FLA: "#C8102E", LAK: "#111111", MIN: "#154734",
  MTL: "#AF1E2D", NSH: "#FFB81C", NJD: "#CC0000", NYI: "#00539B", NYR: "#0038A8",
  OTT: "#C52032", PHI: "#F74902", PIT: "#CFC493", SEA: "#99D9D9", SJS: "#006D75",
  STL: "#002F87", TBL: "#002868", TOR: "#00205B", UTA: "#69B3E7", VAN: "#00843D",
  VGK: "#B4975A", WPG: "#041E42", WSH: "#C8102E",
};

export const TEAM_FULL = {
  ANA: "Anaheim Ducks", BOS: "Boston Bruins", BUF: "Buffalo Sabres",
  CAR: "Carolina Hurricanes", CBJ: "Columbus Blue Jackets", CGY: "Calgary Flames",
  CHI: "Chicago Blackhawks", COL: "Colorado Avalanche", DAL: "Dallas Stars",
  DET: "Detroit Red Wings", EDM: "Edmonton Oilers", FLA: "Florida Panthers",
  LAK: "Los Angeles Kings", MIN: "Minnesota Wild", MTL: "Montréal Canadiens",
  NSH: "Nashville Predators", NJD: "New Jersey Devils", NYI: "New York Islanders",
  NYR: "New York Rangers", OTT: "Ottawa Senators", PHI: "Philadelphia Flyers",
  PIT: "Pittsburgh Penguins", SEA: "Seattle Kraken", SJS: "San Jose Sharks",
  STL: "St. Louis Blues", TBL: "Tampa Bay Lightning", TOR: "Toronto Maple Leafs",
  UTA: "Utah Hockey Club", VAN: "Vancouver Canucks", VGK: "Vegas Golden Knights",
  WPG: "Winnipeg Jets", WSH: "Washington Capitals",
};

export function logoUrl(abbr) {
  return `https://assets.nhle.com/logos/nhl/svg/${abbr}_light.svg`;
}
