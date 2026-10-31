import { PlaceholderModule } from "../../../components/manager/PlaceholderModule";
import { CreditCardIcon } from "../../../components/ui/Icons";

export default function ManagerPaymentsPage() {
  return (
    <PlaceholderModule
      title="Payments"
      subtitle="Transaction histories, settlement logs, and billing reconciliation."
      icon={<CreditCardIcon size={24} />}
    />
  );
}
