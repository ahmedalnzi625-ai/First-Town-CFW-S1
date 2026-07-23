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
} = require('discord.js');

const token = process.env.BOT_TOKEN;
const PREFIX = '!';
const warningFile = path.join(__dirname, 'warnings.json');
const REQUESTS_CHANNEL_ID = process.env.REQUESTS_CHANNEL_ID || process.env.DONE_TEXT_CHANNEL_ID;

if (!token) {
	console.error('Missing BOT_TOKEN in .env');
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
		new ButtonBuilder()
			.setCustomId('request_leave')
			.setLabel('Warn')
			.setStyle(ButtonStyle.Success),
		new ButtonBuilder()
			.setCustomId('request_resign')
			.setLabel('طلب استقالة')
			.setStyle(ButtonStyle.Danger)
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

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
	],
});

client.once('clientReady', () => {
	console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
	if (message.author.bot || !message.guild) {
		return;
	}

	if (!message.content.startsWith(PREFIX)) {
		return;
	}

	const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
	const command = args.shift()?.toLowerCase();

	if (command === 'help') {
		await message.reply(
			[
				'**Commands**',
				'`!panel` - نشر لوحة Warn والاستقالة',
				'`!warn1 @user reason` - Add a warning',
				'`!warnings @user` - Show warnings count and history',
				'`!unwarn @user [index]` - Remove warning by number (last warning if index missing)',
			].join('\n')
		);
		return;
	}

	if (command === 'panel') {
		if (!isModerator(message.member)) {
			await message.reply('تحتاج صلاحية Manage Messages لنشر اللوحة.');
			return;
		}

		await message.channel.send(buildPanelMessage());
		await message.reply('تم نشر لوحة الطلبات.');
		return;
	}

	if (!['warn1', 'warn', 'warnings', 'unwarn'].includes(command)) {
		return;
	}

	if (!isModerator(message.member)) {
		await message.reply('You need `Manage Messages` permission to use warning commands.');
		return;
	}

	const target = message.mentions.users.first();
	if (!target) {
		await message.reply('Mention a user first. Example: `!warn @user reason`');
		return;
	}

	const data = readWarnings();
	const guildId = message.guild.id;
	if (!data[guildId]) {
		data[guildId] = {};
	}
	if (!data[guildId][target.id]) {
		data[guildId][target.id] = [];
	}

	if (command === 'warn1' || command === 'warn') {
		const reason = args.slice(1).join(' ').trim() || 'No reason provided';
		const warning = {
			reason,
			moderatorId: message.author.id,
			timestamp: new Date().toISOString(),
		};

		data[guildId][target.id].push(warning);
		writeWarnings(data);

		await message.reply(
			`${target.tag} was warned. Total warnings: ${data[guildId][target.id].length}`
		);
		return;
	}

	if (command === 'warnings') {
		const userWarnings = data[guildId][target.id];
		if (!userWarnings.length) {
			await message.reply(`${target.tag} has no warnings.`);
			return;
		}

		const lines = userWarnings.map((item, index) => {
			const date = new Date(item.timestamp).toLocaleString();
			return `${index + 1}. ${item.reason} | Mod: <@${item.moderatorId}> | ${date}`;
		});

		await message.reply(
			[`Warnings for ${target.tag}: (${userWarnings.length})`, ...lines].join('\n')
		);
		return;
	}

	if (command === 'unwarn') {
		const userWarnings = data[guildId][target.id];
		if (!userWarnings.length) {
			await message.reply(`${target.tag} has no warnings to remove.`);
			return;
		}

		const possibleIndex = Number.parseInt(args[1], 10);
		let removeIndex = userWarnings.length - 1;

		if (!Number.isNaN(possibleIndex)) {
			removeIndex = possibleIndex - 1;
		}

		if (removeIndex < 0 || removeIndex >= userWarnings.length) {
			await message.reply(`Invalid warning number. Use 1 to ${userWarnings.length}.`);
			return;
		}

		const [removed] = userWarnings.splice(removeIndex, 1);
		writeWarnings(data);

		await message.reply(
			`Removed warning #${removeIndex + 1} from ${target.tag}. Reason was: ${removed.reason}`
		);
	}
});

client.on('interactionCreate', async (interaction) => {
	if (interaction.isButton()) {
		if (interaction.customId === 'request_leave' || interaction.customId === 'request_resign') {
			const isLeave = interaction.customId === 'request_leave';
			const modal = new ModalBuilder()
				.setCustomId(`submit_request|${isLeave ? 'leave' : 'resign'}`)
				.setTitle(isLeave ? 'نموذج Warn' : 'نموذج طلب استقالة');

			const reasonInput = new TextInputBuilder()
				.setCustomId('reason')
				.setLabel(isLeave ? 'سبب الإجازة' : 'سبب الاستقالة')
				.setStyle(TextInputStyle.Paragraph)
				.setRequired(true)
				.setMaxLength(500);

			const periodOrDateInput = new TextInputBuilder()
				.setCustomId('period')
				.setLabel(isLeave ? 'مدة الإجازة (مثال: 3 أيام)' : 'تاريخ آخر يوم (اختياري)')
				.setStyle(TextInputStyle.Short)
				.setRequired(isLeave)
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
				await interaction.reply({
					content: 'لا تملك صلاحية مراجعة الطلبات.',
					ephemeral: true,
				});
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
				.setFields(
					...otherFields,
					{
						name: 'الحالة',
						value: approved ? `✅ تم القبول بواسطة <@${interaction.user.id}>` : `❌ تم الرفض بواسطة <@${interaction.user.id}>`,
						inline: false,
					}
				)
				.setFooter({
					text: `تمت المراجعة بواسطة ${interaction.user.tag}`,
				});

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

	if (interaction.isModalSubmit() && interaction.customId.startsWith('submit_request|')) {
		const reqType = interaction.customId.split('|')[1];
		const reason = interaction.fields.getTextInputValue('reason');
		const period = interaction.fields.getTextInputValue('period') || 'غير محدد';

		let targetChannel = interaction.channel;
		if (REQUESTS_CHANNEL_ID) {
			const maybeChannel = await interaction.guild.channels
				.fetch(REQUESTS_CHANNEL_ID)
				.catch(() => null);
			if (maybeChannel && maybeChannel.isTextBased()) {
				targetChannel = maybeChannel;
			}
		}

		const requestKey = interaction.id;
		const reviewEmbed = new EmbedBuilder()
			.setColor(0xf59e0b)
			.setTitle(reqType === 'leave' ? '📌 Warn جديد' : '📌 طلب استقالة جديد')
			.addFields(
				{ name: 'المستخدم', value: `<@${interaction.user.id}>`, inline: true },
				{ name: 'المعرف', value: interaction.user.id, inline: true },
				{ name: 'النوع', value: reqType === 'leave' ? 'إجازة' : 'استقالة', inline: true },
				{ name: 'السبب', value: reason },
				{
					name: reqType === 'leave' ? 'المدة' : 'آخر يوم',
					value: period,
					inline: false,
				},
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

client.login(token).catch((error) => {
	console.error('Failed to login. Check BOT_TOKEN in .env');
	console.error(error.message);
	process.exit(1);
});
