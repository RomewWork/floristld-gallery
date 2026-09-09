import { Suspense } from "react";
import { CollectionPage } from "@/components/Gallery";
export default function Page() {
  return (
    <Suspense>
      <CollectionPage />
    </Suspense>
  );
}
