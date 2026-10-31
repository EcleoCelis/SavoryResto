import { PlaceholderModule } from "../../../components/manager/PlaceholderModule";
import { BarChartIcon } from "../../../components/ui/Icons";

export default function ManagerReportsPage() {
  return (
    <PlaceholderModule
      title="Reports"
      subtitle="Operational sales performance, daily dish breakdowns, and revenue summaries."
      icon={<BarChartIcon size={24} />}
    />
  );
}
