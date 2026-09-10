import { Suspense } from "react";
import { CollectionPage } from "@/components/Gallery";
export default function Page() {
  return (
    // 静态页面中的查询参数由客户端读取，使用 Suspense 包住 useSearchParams 的消费组件。
    <Suspense>
      <CollectionPage />
    </Suspense>
  );
}
