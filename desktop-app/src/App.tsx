import { CaptureWindow } from "./components/CaptureWindow";
import { LibraryWindow } from "./components/LibraryWindow";
import { PetWindow } from "./components/PetWindow";

export function App() {
  const surface = new URLSearchParams(window.location.search).get("surface") ?? "library";

  if (surface === "pet") return <PetWindow />;
  if (surface === "capture") return <CaptureWindow />;
  return <LibraryWindow />;
}
