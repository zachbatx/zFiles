/* ux.js - Knowledge base for UX Best Practices */
window.kbUX = {
  name: "UX Best Practices",
  features: {
    navigation: {
      title: "Navigation and Information Architecture",
      considerations: [
        "Implement intuitive information architecture",
        "Use clear, descriptive menu labels",
        "Maintain consistent navigation patterns",
        "Design for progressive disclosure",
        "Implement breadcrumbs for deep navigation",
        "Provide clear visual hierarchy",
        "Make current location evident"
      ],
      principles: ["Learnability", "Efficiency", "Consistency", "Visibility"],
      userStories: [
        "A first-time visitor needs to understand site structure",
        "A power user wants efficient navigation to frequent destinations",
        "A returning visitor looks for recently viewed content"
      ]
    },
    forms: {
      title: "Form Design and Input Methods",
      considerations: [
        "Minimize form fields to essential information only",
        "Group related fields logically with clear sections",
        "Show format requirements upfront",
        "Implement smart defaults where appropriate",
        "Provide real-time validation feedback",
        "Allow easy correction of errors",
        "Preserve user data on errors or page refreshes"
      ],
      principles: ["Efficiency", "Error Prevention", "Feedback", "Forgiveness"],
      userStories: [
        "A shopper needs to complete checkout quickly on mobile",
        "A user with partial information needs to save and return later",
        "A confused user needs clear guidance on form requirements"
      ]
    }
    // Additional features can be added here.
  }
};
