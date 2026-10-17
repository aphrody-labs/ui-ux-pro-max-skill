import fs from "fs";
import path from "path";
import { parseStylesCSV } from "@/lib/parseStyles";
import { GalleryGrid } from "@/components/GalleryGrid";

export default function Home() {
  // The gallery renders the canonical skill catalog (no copy in this folder).
  const csvPath = path.join(process.cwd(), "..", ".claude", "skills", "ui-ux-pro-max", "data", "styles.csv");
  const csvContent = fs.readFileSync(csvPath, "utf-8");
  const styles = parseStylesCSV(csvContent);

  return (
    <main>
      <GalleryGrid styles={styles} />
    </main>
  );
}
