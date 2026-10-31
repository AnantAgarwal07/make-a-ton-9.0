import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { handleApiError, P2_PERMISSIONS, requireRole } from "@/lib/auth";
import { validateQuotationTemplateInput } from "@/lib/catalog";
import {
  serializeQuotationTemplate,
  TEMPLATE_INCLUDE,
  validateTemplateEntitiesInDb,
} from "@/lib/catalog";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole(req, P2_PERMISSIONS.TEMPLATES_READ, "Quotation Template details");

    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid template ID" }, { status: 400 });
    }

    const template = await prisma.quotationTemplate.findUnique({
      where: { id },
      include: TEMPLATE_INCLUDE,
    });

    if (!template) {
      return NextResponse.json({ error: "Quotation template not found" }, { status: 404 });
    }

    return NextResponse.json({
      template: serializeQuotationTemplate(template),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole(req, P2_PERMISSIONS.TEMPLATES_WRITE, "Quotation Template update");

    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid template ID" }, { status: 400 });
    }

    const existing = await prisma.quotationTemplate.findUnique({
      where: { id },
      include: { lines: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Quotation template not found" }, { status: 404 });
    }

    const body = (await req.json()) as Record<string, unknown>;
    const validated = validateQuotationTemplateInput(body, true);

    const targetPlanId = validated.planId ?? existing.planId;
    const targetLines =
      validated.lines ??
      existing.lines.map((l) => ({
        productId: l.productId,
        variantId: l.variantId,
        quantity: l.quantity,
      }));

    await validateTemplateEntitiesInDb(targetPlanId, targetLines);

    const updated = await prisma.$transaction(async (tx) => {
      await tx.quotationTemplate.update({
        where: { id },
        data: {
          ...(validated.name !== undefined ? { name: validated.name } : {}),
          ...(validated.planId !== undefined ? { planId: validated.planId } : {}),
          ...(validated.validityDays !== undefined ? { validityDays: validated.validityDays } : {}),
        },
      });

      if (validated.lines !== undefined) {
        await tx.quotationTemplateLine.deleteMany({ where: { templateId: id } });
        await tx.quotationTemplateLine.createMany({
          data: validated.lines.map((l) => ({
            templateId: id,
            productId: l.productId,
            variantId: l.variantId,
            quantity: l.quantity,
          })),
        });
      }

      return tx.quotationTemplate.findUniqueOrThrow({
        where: { id },
        include: TEMPLATE_INCLUDE,
      });
    });

    return NextResponse.json({
      message: "Quotation template updated successfully",
      template: serializeQuotationTemplate(updated),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: { id: string } }
) {
  return PUT(req, context);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole(req, P2_PERMISSIONS.TEMPLATES_DELETE, "Quotation Template deletion");

    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid template ID" }, { status: 400 });
    }

    const existing = await prisma.quotationTemplate.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Quotation template not found" }, { status: 404 });
    }

    await prisma.$transaction([
      prisma.quotationTemplateLine.deleteMany({ where: { templateId: id } }),
      prisma.quotationTemplate.delete({ where: { id } }),
    ]);

    return NextResponse.json({
      message: `Quotation template "${existing.name}" deleted successfully`,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

