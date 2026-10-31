import { PlaceholderModule } from "../../../components/manager/PlaceholderModule";
import { SettingsIcon } from "../../../components/ui/Icons";

export default function ManagerSettingsPage() {
  return (
    <PlaceholderModule
      title="Settings"
      subtitle="Restaurant business hours, operating parameters, and administrative preferences."
      icon={<SettingsIcon size={24} />}
    />
  );
}
