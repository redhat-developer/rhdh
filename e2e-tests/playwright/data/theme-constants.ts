type ThemeInfo = {
  name: "Light" | "Dark" | "Light Dynamic" | "Dark Dynamic";
  primaryColor: string;
  headerColor1: string;
  headerColor2: string;
  navigationIndicatorColor: string;
};

export class ThemeConstants {
  static getThemes() {
    const light: ThemeInfo = {
      name: "Light",
      primaryColor: "#2A61A7",
      headerColor1: "rgb(216, 98, 208)",
      headerColor2: "rgb(216, 164, 98)",
      navigationIndicatorColor: "rgb(98, 216, 105)",
    };

    const dark: ThemeInfo = {
      name: "Dark",
      primaryColor: "#DC6ED9",
      headerColor1: "rgb(190, 122, 45)",
      headerColor2: "rgb(45, 190, 50)",
      navigationIndicatorColor: "rgb(45, 113, 190)",
    };

    const lightDynamic: ThemeInfo = {
      name: "Light Dynamic",
      primaryColor: "rgb(255, 95, 21)",
      headerColor1: "rgb(248, 248, 248)",
      headerColor2: "rgb(248, 248, 248)",
      navigationIndicatorColor: "rgb(255, 95, 21)",
    };

    const darkDynamic: ThemeInfo = {
      name: "Dark Dynamic",
      primaryColor: "#ab75cf",
      headerColor1: "rgb(0, 0, 208)",
      headerColor2: "rgb(255, 246, 140)",
      navigationIndicatorColor: "rgb(244, 238, 169)",
    };

    return [light, dark, lightDynamic, darkDynamic];
  }
}
