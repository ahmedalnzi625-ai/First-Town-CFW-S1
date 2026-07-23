require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
	Client,
	GatewayIntentBits,
	PermissionsBitField,
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	REST,
	Routes,
	SlashCommandBuilder,
} = require('discord.js');

const token = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const warningFile = path.join(__dirname, 'warnings.json');
const REQUESTS_CHANNEL_ID = process.env.REQUESTS_CHANNEL_ID || process.env.DONE_TEXT_CHANNEL_ID;

if (!token) {
	console.error('Missing BOT_TOKEN in .env');
	process.exit(1);
}
if (!CLIENT_ID || !GUILD_ID) {
	console.error('Missing CLIENT_ID or GUILD_ID in .env');
	process.exit(1);
}

if (!fs.existsSync(warningFile)) {
	fs.writeFileSync(warningFile, JSON.stringify({}, null, 2), 'utf8');
}

function readWarnings() {
	try {
		const raw = fs.readFileSync(warningFile, 'utf8');
		return JSON.parse(raw || '{}');
	} catch (error) {
		console.error('Failed to read warnings.json:', error.message);
		return {};
	}
}

function writeWarnings(data) {
	fs.writeFileSync(warningFile, JSON.stringify(data, null, 2), 'utf8');
}

function isModerator(member) {
	return member.permissions.has(PermissionsBitField.Flags.ManageMessages);
}

// ===================== لوحة الـ Panel (3 أزرار Warn حمراء + طلب استقالة) =====================
function buildPanelMessage() {
	const embed = new EmbedBuilder()
		.setColor(0xf59e0b)
		.setTitle('📋 لوحة الإجازات أو الاستقالات')
		.setDescription(
			[
				'تم إنشاء لوحة الطلبات، استخدم الأزرار بالأسفل.',
				'',
				'✅ سيتم إشعار الإدارة لمراجعة الطلب.',
				'⚡ عند قبول الإدارة سيتم تحديث حالة الطلب تلقائيًا.',
			].join('\n')
		)
		.setTimestamp();

	const row = new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId('request_warn_1').setLabel('Warn 1').setStyle(ButtonStyle.Danger),
		new ButtonBuilder().setCustomId('request_warn_2').setLabel('Warn 2').setStyle(ButtonStyle.Danger),
		new ButtonBuilder().setCustomId('request_warn_3').setLabel('Warn 3').setStyle(ButtonStyle.Danger),
		new ButtonBuilder().setCustomId('request_resign').setLabel('طلب استقالة').setStyle(ButtonStyle.Danger)
	);

	return { embeds: [embed], components: [row] };
}

function buildReviewButtons(requesterId, requestKey) {
	return new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(`request_action|approve|${requesterId}|${requestKey}`)
			.setLabel('قبول الطلب')
			.setStyle(ButtonStyle.Success),
		new ButtonBuilder()
			.setCustomId(`request_action|reject|${requesterId}|${requestKey}`)
			.setLabel('رفض الطلب')
			.setStyle(ButtonStyle.Danger)
	);
}

function disabledRows(rows) {
	return rows.map((row) => {
		const nextRow = ActionRowBuilder.from(row);
		nextRow.components = nextRow.components.map((component) =>
			ButtonBuilder.from(component).setDisabled(true)
		);
		return nextRow;
	});
}

// ===================== تعريف أوامر السلاش =====================
const commands = [
	new SlashCommandBuilder().setName('panel').setDescription('نشر لوحة Warn والاستقالة'),
	new SlashCommandBuilder()
		.setName('warn')
		.setDescription('إضافة تحذير لعضو')
		.addUserOption((opt) => opt.setName('user').setDescription('العضو').setRequired(true))
		.addStringOption((opt) => opt.setName('reason').setDescription('السبب').setRequired(false)),
	new SlashCommandBuilder()
		.setName('warnings')
		.setDescription('عرض تحذيرات عضو')
		.addUserOption((opt) => opt.setName('user').setDescription('العضو').setRequired(true)),
	new SlashCommandBuilder()
		.setName('unwarn')
		.setDescription('حذف تحذير من عضو')
		.addUserOption((opt) => opt.setName('user').setDescription('العضو').setRequired(true))
		.addIntegerOption((opt) =>
			opt.setName('index').setDescription('رقم التحذير (اختياري، آخر تحذير افتراضيًا)').setRequired(false)
		),
	new SlashCommandBuilder().setName('help').setDescription('عرض قائمة الأوامر'),
].map((cmd) => cmd.toJSON());

async function registerCommands() {
	const rest = new REST({ version: '10' }).setToken(token);
	try {
		console.log('⏳ يتم تسجيل الأوامر...');
		await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
		console.log('✅ تم تسجيل الأوامر بنجاح.');
	} catch (error) {
		console.error('❌ خطأ أثناء تسجيل الأوامر:', error);
	}
}

const client = new Client({
	intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

client.once('clientReady', () => {
	console.log(`Logged in as ${client.user.tag}`);
});

// ===================== معالجة أوامر السلاش =====================
client.on('interactionCreate', async (interaction) => {
	if (interaction.isChatInputCommand()) {
		const { commandName } = interaction;

		if (commandName === 'help') {
			await interaction.reply({
				content: [
					'**الأوامر المتاحة**',
					'`/panel` - نشر لوحة Warn والاستقالة',
					'`/warn user reason` - إضافة تحذير',
					'`/warnings user` - عرض عدد وتفاصيل التحذيرات',
					'`/unwarn user [index]` - حذف تحذير برقمه (آخر تحذير افتراضيًا)',
				].join('\n'),
				ephemeral: true,
			});
			return;
		}

		if (commandName === 'panel') {
			if (!isModerator(interaction.member)) {
				await interaction.reply({ content: 'تحتاج صلاحية Manage Messages لنشر اللوحة.', ephemeral: true });
				return;
			}
			await interaction.channel.send(buildPanelMessage());
			await interaction.reply({ content: 'تم نشر لوحة الطلبات.', ephemeral: true });
			return;
		}

		if (!isModerator(interaction.member)) {
			await interaction.reply({ content: 'تحتاج صلاحية Manage Messages لاستخدام أوامر التحذير.', ephemeral: true });
			return;
		}

		const data = readWarnings();
		const guildId = interaction.guild.id;
		const target = interaction.options.getUser('user');

		if (!data[guildId]) data[guildId] = {};
		if (!data[guildId][target.id]) data[guildId][target.id] = [];

		if (commandName === 'warn') {
			const reason = interaction.options.getString('reason') || 'لم يُذكر سبب';
			const warning = {
				reason,
				moderatorId: interaction.user.id,
				timestamp: new Date().toISOString(),
			};
			data[guildId][target.id].push(warning);
			writeWarnings(data);

			await interaction.reply(
				`تم تحذير ${target.tag}. إجمالي التحذيرات: ${data[guildId][target.id].length}`
			);
			return;
		}

		if (commandName === 'warnings') {
			const userWarnings = data[guildId][target.id];
			if (!userWarnings.length) {
				await interaction.reply({ content: `${target.tag} ما عنده تحذيرات.`, ephemeral: true });
				return;
			}
			const lines = userWarnings.map((item, index) => {
				const date = new Date(item.timestamp).toLocaleString();
				return `${index + 1}. ${item.reason} | المشرف: <@${item.moderatorId}> | ${date}`;
			});
			await interaction.reply({
				content: [`تحذيرات ${target.tag}: (${userWarnings.length})`, ...lines].join('\n'),
				ephemeral: true,
			});
			return;
		}

		if (commandName === 'unwarn') {
			const userWarnings = data[guildId][target.id];
			if (!userWarnings.length) {
				await interaction.reply({ content: `${target.tag} ما عنده تحذيرات نحذفها.`, ephemeral: true });
				return;
			}
			const possibleIndex = interaction.options.getInteger('index');
			let removeIndex = userWarnings.length - 1;
			if (possibleIndex !== null && !Number.isNaN(possibleIndex)) {
				removeIndex = possibleIndex - 1;
			}
			if (removeIndex < 0 || removeIndex >= userWarnings.length) {
				await interaction.reply({
					content: `رقم تحذير غير صحيح. استخدم رقم من 1 إلى ${userWarnings.length}.`,
					ephemeral: true,
				});
				return;
			}
			const [removed] = userWarnings.splice(removeIndex, 1);
			writeWarnings(data);
			await interaction.reply(
				`تم حذف التحذير رقم ${removeIndex + 1} من ${target.tag}. السبب كان: ${removed.reason}`
			);
			return;
		}
	}

	// ===================== أزرار اللوحة =====================
	if (interaction.isButton()) {
		const warnButtonLabels = {
			request_warn_1: 'Warn 1',
			request_warn_2: 'Warn 2',
			request_warn_3: 'Warn 3',
		};

		if (warnButtonLabels[interaction.customId] || interaction.customId === 'request_resign') {
			const isResign = interaction.customId === 'request_resign';
			const modalKind = isResign ? 'resign' : interaction.customId; // request_warn_1/2/3

			const modal = new ModalBuilder()
				.setCustomId(`submit_request|${modalKind}`)
				.setTitle(isResign ? 'نموذج طلب استقالة' : `نموذج ${warnButtonLabels[interaction.customId]}`);

			const reasonInput = new TextInputBuilder()
				.setCustomId('reason')
				.setLabel(isResign ? 'سبب الاستقالة' : 'سبب الطلب')
				.setStyle(TextInputStyle.Paragraph)
				.setRequired(true)
				.setMaxLength(500);

			const periodOrDateInput = new TextInputBuilder()
				.setCustomId('period')
				.setLabel(isResign ? 'تاريخ آخر يوم (اختياري)' : 'مدة الإجازة (مثال: 3 أيام)')
				.setStyle(TextInputStyle.Short)
				.setRequired(!isResign)
				.setMaxLength(100);

			modal.addComponents(
				new ActionRowBuilder().addComponents(reasonInput),
				new ActionRowBuilder().addComponents(periodOrDateInput)
			);

			await interaction.showModal(modal);
			return;
		}

		if (interaction.customId.startsWith('request_action|')) {
			if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
				await interaction.reply({ content: 'لا تملك صلاحية مراجعة الطلبات.', ephemeral: true });
				return;
			}

			const parts = interaction.customId.split('|');
			const action = parts[1];
			const requesterId = parts[2];
			const approved = action === 'approve';

			const oldEmbed = interaction.message.embeds[0];
			const embed = EmbedBuilder.from(oldEmbed);
			const otherFields = (embed.data.fields || []).filter((field) => field.name !== 'الحالة');
			embed
				.setColor(approved ? 0x22c55e : 0xef4444)
				.setFields(...otherFields, {
					name: 'الحالة',
					value: approved
						? `✅ تم القبول بواسطة <@${interaction.user.id}>`
						: `❌ تم الرفض بواسطة <@${interaction.user.id}>`,
					inline: false,
				})
				.setFooter({ text: `تمت المراجعة بواسطة ${interaction.user.tag}` });

			await interaction.update({
				embeds: [embed],
				components: disabledRows(interaction.message.components),
			});

			const requester = await client.users.fetch(requesterId).catch(() => null);
			if (requester) {
				requester
					.send(
						approved
							? `تم قبول طلبك في سيرفر ${interaction.guild.name}.`
							: `تم رفض طلبك في سيرفر ${interaction.guild.name}.`
					)
					.catch(() => null);
			}
		}
	}

	// ===================== استقبال نموذج (Modal) الطلبات =====================
	if (interaction.isModalSubmit() && interaction.customId.startsWith('submit_request|')) {
		const reqKind = interaction.customId.split('|')[1]; // request_warn_1/2/3 أو resign
		const isResign = reqKind === 'resign';
		const reason = interaction.fields.getTextInputValue('reason');
		const period = interaction.fields.getTextInputValue('period') || 'غير محدد';

		let targetChannel = interaction.channel;
		if (REQUESTS_CHANNEL_ID) {
			const maybeChannel = await interaction.guild.channels.fetch(REQUESTS_CHANNEL_ID).catch(() => null);
			if (maybeChannel && maybeChannel.isTextBased()) {
				targetChannel = maybeChannel;
			}
		}

		const requestKey = interaction.id;
		const typeLabel = isResign
			? 'استقالة'
			: { request_warn_1: 'Warn 1', request_warn_2: 'Warn 2', request_warn_3: 'Warn 3' }[reqKind];

		const reviewEmbed = new EmbedBuilder()
			.setColor(0xf59e0b)
			.setTitle(isResign ? '📌 طلب استقالة جديد' : `📌 طلب ${typeLabel} جديد`)
			.addFields(
				{ name: 'المستخدم', value: `<@${interaction.user.id}>`, inline: true },
				{ name: 'المعرف', value: interaction.user.id, inline: true },
				{ name: 'النوع', value: typeLabel, inline: true },
				{ name: 'السبب', value: reason },
				{ name: isResign ? 'آخر يوم' : 'المدة', value: period, inline: false },
				{ name: 'الحالة', value: '⏳ بانتظار المراجعة', inline: false }
			)
			.setTimestamp();

		await targetChannel.send({
			embeds: [reviewEmbed],
			components: [buildReviewButtons(interaction.user.id, requestKey)],
		});

		await interaction.reply({
			content: 'تم إرسال طلبك للإدارة، انتظر قرار القبول أو الرفض.',
			ephemeral: true,
		});
	}
});

(async () => {
	await registerCommands();
	client.login(token).catch((error) => {
		console.error('Failed to login. Check BOT_TOKEN in .env');
		console.error(error.message);
		process.exit(1);
	});
})();
