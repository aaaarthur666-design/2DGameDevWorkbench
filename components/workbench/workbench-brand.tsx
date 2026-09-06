/* oxlint-disable next/no-img-element -- The small local SVG is shared with the favicon. */
import { workbenchBrand } from '@/lib/workbench/brand';

export function WorkbenchBrand() {
  return (
    <>
      <img
        className="wb-brandmark"
        src={workbenchBrand.icon}
        width={40}
        height={40}
        alt=""
        aria-hidden="true"
      />
      <span>
        <strong>{workbenchBrand.name}</strong>
        <small>{workbenchBrand.tagline}</small>
      </span>
    </>
  );
}
