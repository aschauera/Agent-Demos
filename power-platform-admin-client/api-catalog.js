import { API_SECTIONS as documentedSections } from "./api-catalog.generated.js";

export const API_SECTIONS = documentedSections.map((section) => section.id === "app-management"
  ? {
      ...section,
      title: "Dynamics solutions",
      description: "Discover and install Dynamics application packages for your tenant and environments."
    }
  : section.id === "dynamics"
    ? {
        ...section,
        title: "Finance and Operations",
        description: "Manage Finance and Operations resources through the documented Dynamics API operations."
      }
    : section);

export function getSectionById(id) {
  return API_SECTIONS.find((section) => section.id === id);
}

const appSections = API_SECTIONS.filter((section) => ["power-apps", "power-pages"].includes(section.id));
export const APPLICATION_MODULE = {
  id: "application-management",
  title: "App Management",
  description: "Manage Power Apps, Power Pages, and the available shared operations for Code Apps and model-driven/managed apps.",
  sections: appSections,
  operationCount: appSections.reduce((sum, section) => sum + section.operationCount, 0)
};
const groupedModules = API_SECTIONS.flatMap((section) =>
  section.id === "power-apps" ? [APPLICATION_MODULE] : section.id === "power-pages" ? [] : [section]);
export const NAVIGATION_MODULES = [
  groupedModules[0], APPLICATION_MODULE,
  ...groupedModules.slice(1).filter((section) => section !== APPLICATION_MODULE)
];

export {
  ALL_PERMISSIONS,
  API_ROOT,
  API_REFERENCE,
  CATALOG_GENERATED_AT,
  ENVIRONMENTS_LIST,
  PERMISSIONS_REFERENCE,
  getNamespacePath
} from "./api-catalog.generated.js";
