import { PlaceholderModule } from "../../../components/manager/PlaceholderModule";
import { UserCogIcon } from "../../../components/ui/Icons";

export default function ManagerUserPage() {
  return (
    <PlaceholderModule
      title="User"
      subtitle="Staff user accounts, role-based access management, and operational permissions."
      icon={<UserCogIcon size={24} />}
    />
  );
}
