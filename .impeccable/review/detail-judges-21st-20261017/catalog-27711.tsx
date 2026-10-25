import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion-09-utils/accordion";
import { cn } from "@/lib/utils";
import { MinusIcon, PlusIcon } from "lucide-react";

const items = [
  {
    value: "billing",
    trigger: "How does billing work?",
    content:
      "We offer monthly and annual subscription plans. Billing is charged at the beginning of each cycle, and you can cancel anytime. All plans include automatic backups, 24/7 support, and unlimited team members.",
  },
  {
    value: "security",
    trigger: "Is my data secure?",
    content:
      "Yes. We use end-to-end encryption, SOC 2 Type II compliance, and regular third-party security audits. All data is encrypted at rest and in transit using industry-standard protocols.",
  },
  {
    value: "integration",
    trigger: "What integrations do you support?",
    content:
      "We integrate with 500+ popular tools including Slack, Zapier, Salesforce, HubSpot, and more. You can also build custom integrations using our REST API and webhooks.",
  },
  {
    value: "support",
    trigger: "How do I contact customer support?",
    content:
      "Our support team is available 24/7. You can reach out to us via live chat, email, or by submitting a ticket through your dashboard. Priority support is available for Enterprise plans.",
  },
];

export default function AccordionBorders() {
  return (
    <Accordion
      className="max-w-lg rounded-xl overflow-hidden"
      defaultValue={["billing"]}
    >
      {items.map((item, index) => (
        <AccordionItem
          key={item.value}
          value={item.value}
          className={cn(
            "border-0! rounded-none my-0 bg-muted data-[state=open]:rounded-lg transition-all duration-700 ease-in-out [[data-state=open]+&]:rounded-t-lg [&:has(+[data-state=open])]:rounded-b-lg py-2",
            index === 0
              ? "data-[state=open]:mt-0 data-[state=open]:mb-4"
              : index === items.length - 1
                ? "data-[state=open]:mt-4 data-[state=open]:mb-0"
                : "data-[state=open]:my-4",
          )}
        >
          <AccordionTrigger className="font-medium hover:no-underline text-base px-5 **:data-[slot=accordion-trigger-icon]:hidden cursor-pointer">
            {item.trigger}
            <PlusIcon className="w-4 h-4 shrink-0 group-aria-expanded/accordion-trigger:hidden" />
            <MinusIcon className="w-4 h-4 shrink-0 hidden group-aria-expanded/accordion-trigger:inline" />
          </AccordionTrigger>
          <AccordionContent className="text-muted-foreground px-5">
            {item.content}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

