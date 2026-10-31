import { PlaceholderModule } from "../../../components/manager/PlaceholderModule";
import { ClipboardListIcon } from "../../../components/ui/Icons";

export default function ManagerOrdersPage() {
  return (
    <PlaceholderModule
      title="Orders"
      subtitle="Historical order tracking, fulfillment lifecycle, and kitchen receipts."
      icon={<ClipboardListIcon size={24} />}
    />
  );
}
