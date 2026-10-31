import { PlaceholderModule } from "../../../components/manager/PlaceholderModule";
import { UsersIcon } from "../../../components/ui/Icons";

export default function ManagerCustomerPage() {
  return (
    <PlaceholderModule
      title="Customer"
      subtitle="Customer directory, account activity, and dining history profiles."
      icon={<UsersIcon size={24} />}
    />
  );
}
